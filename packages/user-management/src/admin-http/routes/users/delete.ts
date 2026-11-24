import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  hostRung, principalIdParam, rejectUserError, USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED, USER_VALIDATION, userActorId,
  type HostErrorPredicate, type UserErrorRung, type UserRoutePrincipal,
} from "./shared.js";

/**
 * Moves one user to the Trash. Injected because the trash pipeline is the host's: it owns the
 * Trash store, the self/owner/admin rules and the purge. It throws the identity errors the ladder
 * maps, plus the host's self-target and "no Trash wiring" errors (matched by injected predicates).
 */
export type UserTrashFn = (required: {
  workspaceId: string;
  callerPrincipalId: string;
  principalId: string;
  seededOwnerPrincipalId: string;
}) => Promise<unknown>;

/** The deps this route reads. */
export interface UserDeleteRouteDeps {
  workspaceId: string;
  /** The seeded (bootstrap) owner's principal id, resolved by the host at boot. */
  ownerPrincipalId: PromiseLike<string> | string;
  trashUser: UserTrashFn;
  isSelfDeleteError: HostErrorPredicate;
  /** Matches the host's error for a composition root with no Trash wiring (answered 501). */
  isUserDeleteUnsupportedError: HostErrorPredicate;
}

/** This route's ladder, in the hand-written order. @complexity O(1). */
function userDeleteErrors({ deps }: { deps: UserDeleteRouteDeps }, _optional: Record<string, never> = {}): readonly UserErrorRung[] {
  return [
    USER_FORBIDDEN, hostRung({ matches: deps.isSelfDeleteError, status: 409, code: "SELF_DELETE" }), USER_OWNER_REQUIRED, USER_VALIDATION, USER_NOT_FOUND,
    hostRung({ matches: deps.isUserDeleteUnsupportedError, status: 501, code: "NOT_SUPPORTED" }),
  ];
}

/**
 * DELETE users/:principalId — moves a user to the Trash (delete-user plan v2, decisions 4/5/7, and
 * the OWNER DECISION 2026-09-24 that supersedes decision 1). Gated by the caller being the owner or
 * holding the built-in `admin` role; refuses the caller's own principal (`SELF_DELETE`), the seeded
 * owner or the workspace's last active owner-`*` principal (`OWNER_REQUIRED`); a target already in
 * the Trash is an idempotent 204; 501s when the composition root has no Trash wiring
 * (`NOT_SUPPORTED`, the in-memory identity store) — see the host's trash move for the full rule
 * set. Permanent deletion happens only through the Trash's own purge, never here.
 */
export const userDeleteRoute = defineJsonRoute<{ principalId: string }, undefined, UserDeleteRouteDeps, UserRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId",
  parse: (raw) => ok({ value: { principalId: principalIdParam(raw.params) } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    try {
      const seededOwnerPrincipalId = await deps.ownerPrincipalId;
      await deps.trashUser({ workspaceId: deps.workspaceId, callerPrincipalId, principalId: input.principalId, seededOwnerPrincipalId });
      return ok({ value: undefined });
    } catch (err) {
      return rejectUserError({ err, rungs: userDeleteErrors({ deps }) });
    }
  },
}, { successStatus: 204 });
