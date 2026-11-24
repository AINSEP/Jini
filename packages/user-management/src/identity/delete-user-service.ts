import type { UUID } from "@jini-ai/core/primitives";
import { IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError, OwnerRequiredError, principalKindMayExercisePermission } from "../core/index.js";
import { resolveEffectivePermissions } from "../server/authorize.js";
import type { AuthServiceDeps } from "../server/auth-service.js";
import { authorizeDepsFrom } from "../server/grant-service.js";
import { UserDeleteUnsupportedError } from "./user-purge-types.js";

/**
 * @file `trashUser` (delete-user plan v2, decisions 4/5/7, and the OWNER DECISION 2026-09-24 that
 * supersedes decision 1's "owner-role holders only" default) — moves a `kind='user'` or
 * `kind='api_key'` principal to the Trash (disables it, revokes its sessions, indexes it for
 * restore/purge) instead of hard-deleting it. Renamed from the v1 `deleteUser`, which called
 * `UserPurgePort.purgeUser` directly; that hard-delete path is now reached only through the Trash's
 * own purge (`purgeSelected`, or the retention sweeper 60 days later), never straight from this
 * transition.
 *
 * Purpose:
 * Same shape `admin-crud-service.ts`'s `disablePrincipal` and the v1 `deleteUser` already used
 * (`{ deps: AuthServiceDeps, input: {...} }`, plain-`Error`-subclass control flow), now delegating
 * the actual state change to a `RemoveEntity`-shaped callback (`removeUser`) bound to the Trash at
 * composition, instead of writing to `principals` itself.
 *
 * Architectural role:
 * Ordinary core function, not a port (mirrors `disablePrincipal`'s reasoning). `removeUser`'s type
 * below (`RemoveUserFn`) is a structural copy of `features/trash`'s `RemoveEntity`/`TrashMarkerResult`
 * — this file deliberately does not import the Trash feature, the same "no cross-feature import,
 * only a structurally-compatible callback" convention `features/post/post.ts`'s `RemovePostFn`
 * uses for the identical seam. `principalHoldsOwnerWildcard`/`countActiveOwnerWildcardPrincipals`
 * are a private copy of `admin-crud-service.ts`'s same-named helpers, for the reason given below.
 */

/** Self-trash, permanent delete and disable refusal (409 `SELF_DELETE`). */
export class SelfDeleteError extends Error {}

/** OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — thrown by `enable`/`update`/
 *  `reset-password` when the target principal currently has a `trashed_items` row: those
 *  transitions must refuse a trashed principal rather than silently reactivate one still indexed
 *  for purge. Maps to 409 `USER_IN_TRASH` at the route layer. Declared here, not in each route
 *  file, so every consumer throws (and every route maps) the exact same error identity. */
export class UserInTrashError extends Error {}

/** OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — thrown by `create` when the
 *  requested username belongs to a principal currently in the Trash: the username stays reserved
 *  until that principal is restored or purged. Maps to 409 `USERNAME_IN_TRASH`. */
export class UsernameInTrashError extends Error {}

/**
 * Structurally identical to `features/trash/ports.ts`'s `RemoveEntity`/`TrashMarkerResult` — see
 * this file's header for why `features/identity` copies the shape instead of importing it.
 * `bindRemoveEntity(trash, USER_ENTITY_TYPE)` (composition root) satisfies this type as-is.
 */
export type RemoveUserFn = (required: {
  workspaceId: UUID;
  id: UUID;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: UUID; pluginId?: string | null };
}) => Promise<
  | { ok: true; version: number | null; priorMarker?: string | null; noop?: true }
  | { ok: false; reason: "not-found" | "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number }
>;

export interface DeleteUserDeps {
  identity: AuthServiceDeps;
  /**
   * Pre-bound to the user entity type at composition. `undefined` only for a composition root with
   * no Trash wiring (the in-memory `app.ts` root) — `trashUser` maps that to
   * `UserDeleteUnsupportedError`, the same 501 the v1 `deleteUser` gave `InMemoryUserPurge`.
   */
  removeUser?: RemoveUserFn;
  /**
   * True iff `principalId` already has a `trashed_items` row. Checked before calling `removeUser`
   * so a second trash of the same target is an idempotent no-op — the user `TrashAdapter`'s `hide`
   * has no idempotency branch of its own (it would just re-disable and re-report the current status
   * as `priorMarker`, corrupting the ORIGINAL `priorMarker` a restore needs); see that file's header.
   */
  isInTrash: (required: { principalId: UUID }, optional?: Record<string, never>) => Promise<boolean>;
}

/**
 * What `trash_item`'s `user` kind (`server/runtime/composition/trash-user-tool-port.ts`) reads from
 * the assistant's route deps beyond `IdentityToolDeps`' repo bag — named here so the assistant's
 * deps union (`assistant/tool-registrations.ts`) can carry it without reaching for `RouteDeps`.
 */
export type TrashUserToolDeps = Pick<DeleteUserDeps, "removeUser" | "isInTrash">;

export interface DeleteUserInput {
  workspaceId: UUID;
  callerPrincipalId: UUID;
  principalId: UUID;
  /** Resolved by the caller (`await deps.ownerPrincipalId` at the route layer), mirroring
   *  `disablePrincipal`'s identical convention — keeps this a plain, directly-testable function. */
  seededOwnerPrincipalId: UUID;
}

// Repo-bag assembly and its sharing rationale now live in Jini user-management/server (grant-service.ts).

/** Private copy of `admin-crud-service.ts`'s same-named helper — see this file's header for why. */
export async function principalHoldsOwnerWildcard(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const { deps, workspaceId, principalId } = required;
  const effectiveRows = await resolveEffectivePermissions({
    deps: authorizeDepsFrom(deps.repos),
    principalId,
    workspaceId,
  });
  return effectiveRows.some(
    (row) => row.permission === "*" && row.resourceType == null && row.constraintJson == null
  );
}

/** Builtin admin identity is role-scoped, never inferred from a custom permission grant.
 * The host reconciles user.manage for builtin admins under the 2026-10-07 target rule. */
export async function principalHoldsBuiltinAdminRole(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const { deps, workspaceId, principalId } = required;
  const roleLinks = await deps.repos.principalRoles.listByPrincipalId({ workspaceId, principalId });
  const roles = await Promise.all(
    roleLinks.map((link) => deps.repos.roles.findById({ workspaceId, id: link.roleId }))
  );
  return roles.some((role) => role != null && role.isBuiltin && role.name === "admin");
}

/**
 * OWNER DECISION 2026-10-07 narrows the 2026-09-24 admin trash authority:
 * "other admins should not be able to delete other admins accounts, only the owner can do that"
 * "i shouldnt be allowed to delete my own account right?"
 * Admin callers retain ordinary-user trash authority. Target-aware guards below apply before
 * every destructive transition, regardless of the caller's broader permission grants.
 */
/**
 * Caller classification from 2026-09-24, narrowed by the 2026-10-07 target rule above: true
 * iff `callerPrincipalId` is the owner (an unconstrained `*` holder) or holds the built-in `admin`
 * role — never a custom role, even one granted `user.manage` via `role.manage`.
 *
 * Exported (not just `assertCallerMayManageUserTrash` below) so the Trash's generic restore/purge
 * routes can reuse the SAME rule as a boolean check: those routes gate through
 * `TrashAuthorizeFn`/`mayActOnEntityType` (`features/trash/permissions.ts`), which is boolean-
 * shaped, not exception-shaped, and lives in a different feature this file deliberately does not
 * import (see this file's header) — the composition root wraps that boolean callback around this
 * function for `entityType === "user"` only (`server/runtime/composition/trash-user-admin-
 * override.ts`), so the initial trash action and a later restore/purge of the same user can never
 * drift onto two different rules for who may act on it.
 *
 * @complexity O(1) `resolveEffectivePermissions` call plus O(1)
 * `principalHoldsBuiltinAdminRole` call — evaluated in that order so the common case (the owner)
 * never pays for the role lookup.
 */
export async function callerMayManageUserTrash(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
}): Promise<boolean> {
  const { deps, workspaceId, callerPrincipalId } = required;
  const isOwner = await principalHoldsOwnerWildcard({ deps, workspaceId, principalId: callerPrincipalId });
  if (isOwner) return true;
  return principalHoldsBuiltinAdminRole({ deps, workspaceId, principalId: callerPrincipalId });
}

/** Throws unless {@link callerMayManageUserTrash} says the caller may act. `IdentityForbiddenError`
 *  is the same error `assertCallerHasAnyPermission` throws for every other permission gate in this
 *  codebase, so the route layer's existing 403 mapping needs no new branch.
 *  @complexity See {@link callerMayManageUserTrash}. */
async function assertCallerMayManageUserTrash(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  callerPrincipalId: UUID;
}): Promise<void> {
  const { deps, workspaceId, callerPrincipalId } = required;
  if (await callerMayManageUserTrash({ deps, workspaceId, callerPrincipalId })) return;
  throw new IdentityForbiddenError({ message: `principal '${callerPrincipalId}' is not authorized to trash, restore or permanently delete users`, permission: "*", reason: "no_grant" });
}

/** Private copy of `admin-crud-service.ts`'s same-named helper — see this file's header for why.
 *  @complexity O(n) in the workspace's principal count, same bound that helper documents. */
async function countActiveOwnerWildcardPrincipals(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
}): Promise<number> {
  const { deps, workspaceId } = required;
  const allPrincipals = await deps.repos.principals.list({ workspaceId });
  // Same kind bar as the library helper: a site member can never be the remaining owner, and the
  // member roster costs no grant reads here.
  const activePrincipals = allPrincipals.filter(
    (principal) =>
      principal.status === "active" && principalKindMayExercisePermission({ kind: principal.kind, permission: "*" })
  );
  const flags = await Promise.all(
    activePrincipals.map((principal) =>
      principalHoldsOwnerWildcard({ deps, workspaceId, principalId: principal.id })
    )
  );
  return flags.filter(Boolean).length;
}

/** Post-write invariant for grant removal; throw inside the transaction so the write rolls back. */
export async function assertActiveOwnerFloor(required: { deps: AuthServiceDeps; workspaceId: UUID },
  _optional: Record<string, never> = {}): Promise<void> {
  if (await countActiveOwnerWildcardPrincipals(required) <= 0) {
    throw new OwnerRequiredError({ message: "the workspace must keep at least one active owner-`*` principal" });
  }
}

/** Shared classification for the target rule and Users roster affordances. */
export async function userAccountProtection(required: {
  deps: AuthServiceDeps; workspaceId: UUID; principalId: UUID;
}, _optional: Record<string, never> = {}): Promise<{ isOwner: boolean; isProtectedAccount: boolean }> {
  const { deps, workspaceId, principalId } = required;
  const isOwner = await principalHoldsOwnerWildcard({ deps, workspaceId, principalId });
  const links = await deps.repos.principalRoles.listByPrincipalId({ workspaceId, principalId });
  const roles = await Promise.all(links.map(link => deps.repos.roles.findById({ workspaceId, id: link.roleId })));
  return { isOwner, isProtectedAccount: isOwner || roles.some(role => role?.isBuiltin && (role.name === "admin" || role.name === "owner")) };
}

export type UserAccountAction = "trash" | "purge" | "disable" | "reset-password" | "enable";

/** Only the destructive actions guard against self-targeting: resetting your own password is
 *  allowed, and a disabled account cannot sign in to re-enable itself (an active owner re-enabling
 *  itself is a harmless no-op the roster relies on). */
const SELF_TARGET_REFUSED: ReadonlySet<UserAccountAction> = new Set(["trash", "purge", "disable"]);

/** B151 (owner rule 2026-11-20): "only the owner may re-enable an owner-disabled admin" — so
 *  `enable` gets its own plain wording instead of the destructive-action sentence. An owner target
 *  keeps the library's existing "modify an owner principal" sentence the roster already shows. */
function ownerRequiredMessage({ action, targetIsOwner }: { action: UserAccountAction; targetIsOwner: boolean }): string {
  if (action !== "enable") return "only an owner can delete, trash, disable or reset the password of an admin or owner account";
  return targetIsOwner ? "only an owner can modify an owner principal" : "only an owner can turn an admin account back on";
}

/** The owner-only gate, split out of {@link assertUserAccountAction} to keep it within the
 *  complexity cap: a protected (admin/owner or seeded-owner) target needs a caller who holds the
 *  owner wildcard; a call with no caller (system paths) is not gated here. */
async function assertCallerMayActOnProtected(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  action: UserAccountAction;
  callerPrincipalId: UUID | undefined;
  protectedTarget: boolean;
  targetIsOwner: boolean;
}, _optional: Record<string, never> = {}): Promise<void> {
  const { deps, workspaceId, action, callerPrincipalId, protectedTarget, targetIsOwner } = required;
  if (callerPrincipalId === undefined || !protectedTarget) return;
  if (await principalHoldsOwnerWildcard({ deps, workspaceId, principalId: callerPrincipalId })) return;
  throw new OwnerRequiredError({ message: ownerRequiredMessage({ action, targetIsOwner }) });
}

/** The owner account contract. Run inside the
 * same identity transaction as the write. Retention has no caller, but still preserves owners. */
export async function assertUserAccountAction(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
  action: UserAccountAction;
}, optional: { callerPrincipalId?: UUID; seededOwnerPrincipalId?: UUID } = {}): Promise<void> {
  const { deps, workspaceId, principalId, action } = required;
  const { callerPrincipalId, seededOwnerPrincipalId } = optional;
  if (SELF_TARGET_REFUSED.has(action) && principalId === callerPrincipalId) {
    throw new SelfDeleteError(action === "disable" ? "you cannot disable your own account" : "you cannot delete your own account");
  }
  const target = await deps.repos.principals.findById({ workspaceId, id: principalId });
  if (!target) throw new IdentityNotFoundError({ message: `principal '${principalId}' was not found` });
  const { isOwner: owner, isProtectedAccount } = await userAccountProtection({ deps, workspaceId, principalId });
  const isSeededOwner = principalId === seededOwnerPrincipalId;
  await assertCallerMayActOnProtected({ deps, workspaceId, action, callerPrincipalId,
    protectedTarget: isProtectedAccount || isSeededOwner, targetIsOwner: owner || isSeededOwner });
  await assertDestructiveAccountInvariants({ deps, workspaceId, principalId, action, targetStatus: target.status, owner },
    { seededOwnerPrincipalId });
}

async function assertDestructiveAccountInvariants(required: {
  deps: AuthServiceDeps;
  workspaceId: UUID;
  principalId: UUID;
  action: UserAccountAction;
  targetStatus: string;
  owner: boolean;
}, optional: { seededOwnerPrincipalId?: UUID | undefined } = {}): Promise<void> {
  const { deps, workspaceId, principalId, action, targetStatus, owner } = required;
  // Neither action removes an active owner, so the seeded-owner and owner-floor checks do not apply.
  if (action === "reset-password" || action === "enable") return;
  if (principalId === optional.seededOwnerPrincipalId) {
    throw new OwnerRequiredError({ message: action === "disable" ? "the seeded owner principal can never be disabled" : "the seeded owner principal can never be deleted" });
  }
  if (targetStatus === "active" && owner && await countActiveOwnerWildcardPrincipals({ deps, workspaceId }) <= 1) {
    throw new OwnerRequiredError({ message: "the workspace must keep at least one active owner-`*` principal" });
  }
}

function trashRemovalInput({ identity, input, target, title, subtitle }: {
  identity: DeleteUserDeps['identity']; input: DeleteUserInput;
  target: NonNullable<Awaited<ReturnType<DeleteUserDeps['identity']['repos']['principals']['findById']>>>; title: string; subtitle: string | null;
}): Parameters<RemoveUserFn>[0] {
  return {
      workspaceId: input.workspaceId,
      id: target.id,
      display: { title, subtitle },
      at: new Date(identity.clock.nowMs()).toISOString(),
      expectedVersion: null,
      actor: { principalId: input.callerPrincipalId },
    };
}



/**
 * Moves a user (or the orphan `api_key` "runner" principal) to the Trash. Checked in order: caller
 * is the owner or holds the built-in `admin` role (OWNER DECISION 2026-09-24), target exists,
 * target is `kind='user'` or `kind='api_key'`, target is not the caller, target is not the seeded
 * owner, target is not the workspace's last active owner-`*` principal. A target already in the
 * Trash is an idempotent no-op. On success, delegates the state change to `deps.removeUser`
 * (disables the principal, revokes its sessions, and indexes it for the Trash screen — see
 * `features/trash/adapters/user.ts`), which records its own `identity.user.trashed` audit event.
 *
 * @complexity O(n) in the workspace's principal count (the owner-count guard, same bound
 * `disablePrincipal` documents) plus `deps.removeUser`'s own O(1) transaction.
 */
async function runTrashUser(required: {
  deps: DeleteUserDeps;
  input: DeleteUserInput;
}): ReturnType<RemoveUserFn> {
  const { deps, input } = required;
  const { identity, removeUser, isInTrash } = deps;

  await assertCallerMayManageUserTrash({
    deps: identity,
    workspaceId: input.workspaceId,
    callerPrincipalId: input.callerPrincipalId,
  });

  const target = await identity.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: input.principalId,
  });
  if (!target) throw new IdentityNotFoundError({ message: `principal '${input.principalId}' was not found` });

  if (target.kind !== "user" && target.kind !== "api_key") {
    throw new IdentityValidationError({ message: `DELETE_USER target must be a user or api_key principal, got kind='${target.kind}'` });
  }

  await assertUserAccountAction({ deps: identity, workspaceId: input.workspaceId, principalId: target.id, action: "trash" },
    { callerPrincipalId: input.callerPrincipalId, seededOwnerPrincipalId: input.seededOwnerPrincipalId });

  if (await isInTrash({ principalId: target.id })) {
    return { ok: true, version: null, noop: true } as const;
  }

  let title = target.displayName;
  let subtitle: string | null = null;
  if (target.kind === "user") {
    const user = await identity.repos.users.findByPrincipalId({
      workspaceId: input.workspaceId,
      principalId: target.id,
    });
    if (!user) throw new IdentityNotFoundError({ message: `user '${target.id}' was not found` });
    title = user.username;
    subtitle = user.email ?? null;
  } else {
    subtitle = "API key";
  }

  if (!removeUser) {
    throw new UserDeleteUnsupportedError(
      "this identity store has no Trash wiring; users cannot be deleted (composition-only limitation)"
    );
  }

  return removeUser(trashRemovalInput({ identity, input, target, title, subtitle }));
}

/** What {@link createTrashUserService} returns: the serialized `trashUser` transition. */
export interface TrashUserService {
  trashUser(required: { deps: DeleteUserDeps; input: DeleteUserInput }): ReturnType<RemoveUserFn>;
}

/**
 * Serializes `trashUser` calls (decision 4's concurrency rule, carried over unchanged from v1's
 * `deleteUser`): without this, two concurrent trashes targeting the workspace's only two active
 * owner-`*` principals could each read `activeOwnerCount === 2` before either write lands, and both
 * would pass the INV-08 guard — chaining every call onto one promise makes the read-then-write
 * sequence for one call fully finish (or throw) before the next call's read begins.
 * Factory-owned, not module-level: the host creates ONE instance per process at composition, and
 * every caller (the admin route, the assistant's `trash_item` port) shares it. Not per-workspace:
 * a host that runs one workspace per process gets a single chain exactly as serialized as a
 * per-workspace map would be, with no map to leak.
 *
 * @complexity O(1) to enqueue; each call costs {@link runTrashUser}'s own bound once it runs.
 */
export function createTrashUserService(_required: Record<string, never> = {},
  _optional: Record<string, never> = {}): TrashUserService {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    trashUser(required) {
      const { deps, input } = required;
      // Keep the local queue's historical ordering, and join the shared transaction so competing
      // grant/status writers cannot race its owner-floor reads. The Trash runner joins this kernel.
      const atomicRun = () => deps.identity.repos.transactions.run({ workspaceId: input.workspaceId, execute: () => runTrashUser({ deps, input }) });
      const result = tail.then(atomicRun, atomicRun);
      // Swallow the rejection on `tail` itself (not on `result`, which the caller still awaits and
      // sees rejected) so one failed trash never poisons the chain for every trash queued after it —
      // the same "chain for ordering only, never for the value" shape a serialization promise needs
      // to stay usable across repeated failures.
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
