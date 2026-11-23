import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { resetUserPassword } from "../../../server/admin-crud-service.js";
import {
  hostRung, principalIdParam, rejectUserError, rejectUserInTrash, USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED, USER_VALIDATION, userActorId,
  type AssertUserAccountActionFn, type HostErrorPredicate, type IdentityServicesFn, type IsInTrashFn, type UserErrorRung, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserResetPasswordRouteDeps {
  workspaceId: string;
  /** Identity service(s), injected: the admin-http entry may not reach the `server` source domain
   *  (subpath isolation); the host binds them from `@jini-ai/user-management/server`. */
  resetUserPassword: typeof resetUserPassword;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
  /** The seeded (bootstrap) owner's principal id, resolved by the host at boot. */
  ownerPrincipalId: PromiseLike<string> | string;
  assertUserAccountAction: AssertUserAccountActionFn;
  /** Matches the host's self-target error. */
  isSelfDeleteError: HostErrorPredicate;
}

/**
 * This route's ladder, in the hand-written order. The host's account guard deliberately exempts
 * `reset-password` from its self-target refusal (the owner may reset its own password), so no
 * current path raises the self-target error here — the rung stays as defence-in-depth should that
 * exemption change. @complexity O(1).
 */
function resetPasswordErrors({ deps }: { deps: UserResetPasswordRouteDeps }, _optional: Record<string, never> = {}): readonly UserErrorRung[] {
  return [hostRung({ matches: deps.isSelfDeleteError, status: 409, code: "SELF_DELETE" }), USER_FORBIDDEN, USER_OWNER_REQUIRED, USER_VALIDATION, USER_NOT_FOUND];
}

/**
 * POST users/:principalId/reset-password — `RESET_USER_PASSWORD` (SPEC-006 0.6.0, REQ-17). Gated
 * by **`user.manage`** only (stricter than `UPDATE_USER`). No response body — the raw new password
 * is never echoed back (INV-05); revokes every one of the target's active sessions (AC-29). Refuses
 * a THIRD-PARTY caller resetting the seeded owner's password (REQ-11/REQ-13) — the owner may still
 * reset its own — see `server/admin-crud-service.ts`'s `resetUserPassword` for the full contract;
 * `seededOwnerPrincipalId` is resolved exactly as the disable route resolves it.
 */
export const userResetPasswordRoute = defineJsonRoute<{ principalId: string; password: string }, undefined, UserResetPasswordRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId/reset-password",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    return ok({ value: { principalId: principalIdParam(raw.params), password: String(body.password ?? "") } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    const { workspaceId } = deps;
    const { principalId, password } = input;
    try {
      const seededOwnerPrincipalId = await deps.ownerPrincipalId;
      // OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — refuse BEFORE the transition;
      // see `rejectUserInTrash` for why. Not a rung, so `rejectUserError` rethrows it unchanged.
      if (await deps.isInTrash({ principalId })) rejectUserInTrash();
      const services = deps.identityServices();
      await services.repos.transactions.run({ workspaceId, execute: async () => {
        await deps.assertUserAccountAction({ deps: services, workspaceId, principalId, action: "reset-password" }, { callerPrincipalId, seededOwnerPrincipalId });
        return deps.resetUserPassword({ deps: services, input: { workspaceId, callerPrincipalId, principalId, password, seededOwnerPrincipalId } });
      } });
      return ok({ value: undefined });
    } catch (err) {
      return rejectUserError({ err, rungs: resetPasswordErrors({ deps }) });
    }
  },
}, { successStatus: 204 });
