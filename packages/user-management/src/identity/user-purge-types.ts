import type { UUID } from "@jini-ai/core/primitives";
import type { DomainEvent } from "@jini-ai/core/contracts/events";

/**
 * @file `DELETE_USER`'s purge port (delete-user plan, 2026-09-24, decision 2/7).
 *
 * Purpose:
 * `@jini-ai/cms/identity` has no delete method on any of its nine repo ports — user removal is a
 * host-local transition, so its port is declared HERE rather than in the library, the same
 * reasoning `api-key-types.ts`'s header gives for the tenth (`ApiKeyRepoPort`) port living in this
 * repo. `UserPurgePort` is the eleventh: one method, `purgeUser`, that hard-deletes every identity
 * row a principal owns (`principal_roles`, `principal_policies`, `sessions`, `api_keys`,
 * `setting_values_user`, `admin_execution_credentials`, `identity_users`, `principals`) and appends
 * an audit event, all as one atomic unit — see `user-purge.ts`'s class doc for why that
 * atomicity requires a real SQL transaction the in-memory store cannot offer.
 *
 * `purgeUser` takes a `buildEvent` callback rather than an already-built `DomainEvent` (adjusted
 * from the delete-user plan's original "caller builds the event" wording, disclosed as a deviation
 * in the Slice 2 handoff): the event's payload must report exactly which rows were removed
 * (`PurgeCounts`), and those counts are only known once the deletes have actually run — which, for
 * the atomicity guarantee above, has to happen inside the SAME transaction as the outbox insert.
 * The caller (`delete-user-service.ts`, and delete-user plan v2's `adapters/user.ts`) still owns
 * every other event field (id, name, timestamps, actor, aggregate, payload shape) — it just
 * receives the counts as the callback's argument instead of guessing them up front.
 *
 * `reason` (delete-user plan v2, decision 6) is optional and additive: a caller purging through the
 * Trash states whether this was a hand-triggered permanent delete (`"manual"`) or the retention
 * sweeper's automatic purge (`"retention"`), and that same value is handed back to `buildEvent` so
 * the event payload can report it. `delete-user-service.ts`'s existing call site passes neither and
 * its `buildEvent` callback ignores the second argument, so its behavior is unchanged.
 *
 * Architectural role:
 * Interfaces and types only — no logic, mirroring `api-key-types.ts`'s own split. The two adapters
 * are `InMemoryUserPurge` (below — refuses outright, see its own doc) and `SqlUserPurge`
 * (`user-purge.ts`; `SqliteUserPurge` is its content-db subclass) — an ADR-006 rule-of-two, not a single-adapter port.
 */

/** Exact row counts `purgeUser` removed, one field per purged table (decision 2's list, minus
 *  `identity_users`/`principals` themselves, which are single-row-per-principal by construction and
 *  need no count). Returned so the audit event payload and the caller's response can both report
 *  precisely what was removed instead of re-deriving it from a second read. */
export interface PurgeCounts {
  roles: number;
  policies: number;
  sessions: number;
  apiKeys: number;
  userSettings: number;
}

/** Why a purge happened — see this file's header for why it exists and why it is optional. */
export type UserPurgeReason = "manual" | "retention";

export interface UserPurgePort {
  /**
   * Hard-deletes `principalId`'s identity rows in `workspaceId`, then calls `buildEvent` with the
   * exact counts just removed (and `reason`, verbatim) and appends the returned event to the
   * outbox — all inside the same atomic unit as the deletes. `buildEvent` must be a pure,
   * synchronous, side-effect-free function of its arguments (the real adapter calls it
   * mid-transaction).
   */
  purgeUser(required: {
    workspaceId: UUID;
    principalId: UUID;
    buildEvent: (required: { removed: PurgeCounts }, optional?: { reason?: UserPurgeReason }) => DomainEvent;
    reason?: UserPurgeReason;
  }): Promise<PurgeCounts>;
}

/** Thrown by `InMemoryUserPurge.purgeUser` below; mapped to 501 `NOT_SUPPORTED` at the route layer
 *  (delete-user plan decision 4's last rule). */
export class UserDeleteUnsupportedError extends Error {}

/**
 * The in-memory identity store (`@jini-ai/cms/identity`'s `InMemoryPrincipalRepo` et al., used by
 * the hermetic test/dev composition root) has no delete methods at all — faking a purge over it
 * would either silently no-op (a purge that doesn't purge) or hand-roll a second, untested deletion
 * path with no transactional guarantee. Refusing outright is the honest behavior: `DELETE_USER` is
 * SQLite-only until the in-memory store grows real delete support.
 */
export class InMemoryUserPurge implements UserPurgePort {
  async purgeUser(_required: { workspaceId: UUID; principalId: UUID }): Promise<PurgeCounts> {
    throw new UserDeleteUnsupportedError("user delete requires the SQLite identity store");
  }
}
