import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { IdentityConflictError } from "../../../core/types.js";
import { createUser } from "../../../server/grant-service.js";
import { normalizeUsername } from "../../../server/username.js";
import { toAdminUserResponse, type AdminUserResponse } from "../../http/users.js";
import {
  rejectUserError, USER_FORBIDDEN, USER_USERNAME_CONFLICT, USER_VALIDATION, userActorId,
  type IdentityServicesFn, type IsInTrashFn, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserCreateRouteDeps {
  workspaceId: string;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
}

/** This route's three body fields, read off an untyped body in one place. */
export interface UserCreateInput { username: string; email: string | undefined; password: string }

/** Unmapped failures go to the host. */
const USER_CREATE_ERRORS = [USER_FORBIDDEN, USER_USERNAME_CONFLICT, USER_VALIDATION] as const;

/**
 * OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — re-derives whether `rawUsername`'s
 * existing holder (the one `createUser` itself just found and rejected as a conflict) is currently
 * in the Trash. Run only AFTER `createUser` throws `IdentityConflictError`, not as a pre-check
 * before calling it: `createUser` runs its own permission gate first (`assertCallerHasAnyPermission`),
 * so pre-checking here would leak "a trashed user holds this username" to a caller who was never
 * authorized to reach the conflict path at all. `normalizeUsername` is the exact function
 * `createUser` normalizes with internally, so this looks up the SAME row `createUser` found.
 *
 * @complexity O(1): one normalize, one indexed `findByUsername`, one `isInTrash` check.
 */
async function usernameHeldByTrashedUser({ deps, rawUsername }: { deps: UserCreateRouteDeps; rawUsername: string }, _optional: Record<string, never> = {}): Promise<boolean> {
  const username = normalizeUsername({ raw: rawUsername });
  if (!username) return false;
  const existingUser = await deps.identityServices().repos.users.findByUsername({ workspaceId: deps.workspaceId, username });
  if (!existingUser) return false;
  return deps.isInTrash({ principalId: existingUser.principalId });
}

/**
 * POST users — `CREATE_USER` (state.spec §3, REQ-01/MF-1). Gated by `user.manage` only (operator
 * login creation), enforced inside `grant-service.ts`'s `createUser` rather than here — see that
 * file's header for why the gate lives in the service function.
 *
 * Not routed through the SPEC-001 command gateway: `CREATE_USER` mints two rows (principal + user)
 * as one structural unit, not a single entity with a natural inverse-capture/revert story.
 */
export const userCreateRoute = defineJsonRoute<UserCreateInput, { user: AdminUserResponse }, UserCreateRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    return ok({ value: {
      username: String(body.username ?? ""),
      email: body.email !== undefined ? String(body.email) : undefined,
      password: String(body.password ?? ""),
    } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    try {
      const { principal, user } = await createUser({
        deps: deps.identityServices(),
        input: { workspaceId: deps.workspaceId, callerPrincipalId, username: input.username, password: input.password },
      }, { email: input.email });
      return ok({ value: { user: toAdminUserResponse({ principal, user, roleIds: [], policyIds: [] }) } });
    } catch (err) {
      // OWNER DECISION 2026-09-24 (decision 7) — a username conflict `createUser` itself already
      // found and rejected may belong to a TRASHED user; see `usernameHeldByTrashedUser`'s doc for
      // why this re-check runs only here, after `createUser`'s own permission gate has passed.
      if (err instanceof IdentityConflictError && (await usernameHeldByTrashedUser({ deps, rawUsername: input.username }))) {
        throw new RouteRefusalError({ status: 409, body: { error: "a user with this username is in the Trash; restore or delete them permanently first", code: "USERNAME_IN_TRASH" } });
      }
      return rejectUserError({ err, rungs: USER_CREATE_ERRORS });
    }
  },
}, { successStatus: 201 });
