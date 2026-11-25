import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome } from "@jini-ai/core/contracts/site/cms-trash";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { PurgeCounts, UserPurgePort, UserPurgeReason } from "../user-purge-types.js";

/**
 * @file `TrashAdapter` for users (delete-user plan v2, decision 4) — bespoke rather than a
 * `TRASHABLE` registry entry, because `hide` writes two tables (`principals` AND `sessions`) and
 * `purge` must go through `UserPurgePort.purgeUser` (`SqlUserPurge`, `identity/user-purge.ts`) for
 * its own eight-table delete, not through a single-table `compareAndDelete`. Mirrors
 * `@jini-ai/cms/trash/adapters/directory`'s "bespoke adapter" precedent.
 *
 * `entityVersion` is always `null`: `principals` has no version column, so `hide`/`unhide`/`purge`
 * never receive a meaningful `expectedVersion` to compare against (the trash core still passes one
 * through, per the shared `TrashAdapter` contract, but this adapter has nothing to check it against).
 *
 * One Kysely body over the content database's storage kernel, so the same statements run on SQLite,
 * PGlite and Postgres. Each method is read-then-write, so each runs in `kernel.transaction` holding
 * `kernel.lockKey` for the principal (a nested transaction joins the trash core's own). That lock
 * only orders Trash against Trash: `SqlPrincipalRepo.save` never takes it, so on Postgres a
 * re-enable or disable can commit between the read and the write. `hide`/`unhide` therefore repeat
 * the status they read in the `UPDATE`'s `WHERE`, and 0 affected rows is `version-changed` — no
 * stale `priorMarker`, no overwritten status, no event. `hide`/`unhide` insert their own
 * `identity.user.trashed` / `identity.user.restored` outbox event ({@link outboxEventValues}) in that
 * same transaction as the marker write; `purge`'s `purgeUser` joins it too, so the status check and
 * the delete cannot be split by a concurrent restore.
 */

type Empty = Record<string, never>;
export interface UserTrashAdapterDeps {
  store: {
    readPrincipal(required: { workspaceId: string; principalId: string }): Promise<{ status: string; displayName: string } | null>;
    readDisplayUsername(required: { workspaceId: string; principalId: string; fallback: string }): Promise<string>;
    compareAndSetStatus(required: { workspaceId: string; principalId: string; expected: string; next: string; disabledAt?: string | null }): Promise<number>;
    revokeSessions(required: { workspaceId: string; principalId: string }): Promise<number>;
    appendEvent(required: { event: DomainEvent }): Promise<void>;
    underPrincipalLock<T>(required: { workspaceId: string; principalId: string; run: () => Promise<T> }): Promise<T>;
  };
  policy: {
    entityType: string;
    assertAccountAction?: (required: { workspaceId: string; principalId: string; action: "trash" | "purge" }, optional: { callerPrincipalId?: string | undefined }) => Promise<void>;
  };
  purge: UserPurgePort;
  idGen: { next(): string };
  clock: { nowIso(): string };
}
type UserTrashContext = UserTrashAdapterDeps;

function userTrashHide({ policy, store, idGen, clock }: UserTrashContext): Pick<TrashAdapter, "hide"> {
  return {
    /**
     * Disables the principal, revokes every session and records `identity.user.trashed`.
     *
     * No idempotency branch for an already-disabled principal: re-trashing one just re-disables it
     * (a no-op write) and reports its current `status` as `priorMarker` again — the "already in the
     * Trash" short-circuit belongs to the caller (`trashUser`, delete-user plan v2 Slice 2), which
     * checks the Trash index before ever reaching this adapter.
     */
    async hide(required, optional = {}): Promise<TrashMarkerResult> {
      const { workspaceId, entityId } = required;
      return store.underPrincipalLock({ workspaceId, principalId: entityId, run: async () => {
        const before = await store.readPrincipal({ workspaceId, principalId: entityId });
        if (!before) return { ok: false, reason: "not-found" };
        await policy.assertAccountAction?.({ workspaceId, principalId: entityId, action: "trash" },
          { callerPrincipalId: optional.actor?.principalId });

        const disabled = await store.compareAndSetStatus({ workspaceId, principalId: entityId, expected: before.status, next: "disabled", disabledAt: required.at });
        if (Number(disabled) === 0) return { ok: false, reason: "version-changed" };
        const revoked = await store.revokeSessions({ workspaceId, principalId: entityId });

        const username = await store.readDisplayUsername({ workspaceId, principalId: entityId, fallback: before.displayName });
        await store.appendEvent({ event: {
          id: idGen.next(),
          name: "identity.user.trashed",
          occurredAt: clock.nowIso(),
          aggregateId: entityId,
          workspaceId,
          ...(optional.actor ? { actorId: optional.actor.principalId } : {}),
          payload: { principalId: entityId, username, priorStatus: before.status, sessionsRevoked: Number(revoked) },
        } });

        return { ok: true, version: null, priorMarker: before.status };
      } });
    },

  };
}

function userTrashUnhide({ policy, store, idGen, clock }: UserTrashContext): Pick<TrashAdapter, "unhide"> {
  return {
    /**
     * Restores the principal to `priorMarker` (decision 4: `priorMarker ?? "disabled"`) and records
     * `identity.user.restored`. Sessions are never re-created — a restore never revives an old
     * cookie (decision 2).
     */
    async unhide(required, optional = {}): Promise<TrashMarkerResult> {
      const { workspaceId, entityId } = required;
      return store.underPrincipalLock({ workspaceId, principalId: entityId, run: async () => {
        const before = await store.readPrincipal({ workspaceId, principalId: entityId });
        if (!before) return { ok: false, reason: "not-found" };

        const restoredStatus = optional.priorMarker ?? "disabled";
        const restored = await store.compareAndSetStatus({ workspaceId, principalId: entityId, expected: before.status, next: restoredStatus,
          ...(restoredStatus === "active" ? { disabledAt: null } : {}) });
        if (Number(restored) === 0) return { ok: false, reason: "version-changed" };

        const username = await store.readDisplayUsername({ workspaceId, principalId: entityId, fallback: before.displayName });
        await store.appendEvent({ event: {
          id: idGen.next(),
          name: "identity.user.restored",
          occurredAt: clock.nowIso(),
          aggregateId: entityId,
          workspaceId,
          ...(optional.actor ? { actorId: optional.actor.principalId } : {}),
          payload: { principalId: entityId, username, restoredStatus },
        } });

        return { ok: true, version: null };
      } });
    },

  };
}

function userTrashPurge({ policy, store, purge, idGen, clock }: UserTrashContext): Pick<TrashAdapter, "purge"> {
  return {
    /**
     * Hard-deletes the principal's identity rows via {@link UserPurgePort.purgeUser} (decision 4) —
     * never a live principal (an `active` status means it was never trashed, or was re-enabled out
     * from under an index row someone forgot to clear; either way it is not this adapter's call to
     * remove it). Reachable from both `purgeSelected` (an operator, `optional.actor` set — `reason:
     * "manual"`) and the retention sweeper (`optional.actor` absent — `reason: "retention"`,
     * `actorId` left off the event, decision 6).
     */
    async purge(required, optional = {}): Promise<TrashPurgeOutcome> {
      const { workspaceId, entityId } = required;
      return store.underPrincipalLock({ workspaceId, principalId: entityId, run: async () => {
        const before = await store.readPrincipal({ workspaceId, principalId: entityId });
        if (!before) return "already-gone";
        await policy.assertAccountAction?.({ workspaceId, principalId: entityId, action: "purge" },
          { callerPrincipalId: optional.actor?.principalId });
        if (before.status === "active") return "version-changed";

        const username = await store.readDisplayUsername({ workspaceId, principalId: entityId, fallback: before.displayName });
        const reason: UserPurgeReason = optional.actor ? "manual" : "retention";

        await purge.purgeUser({
          workspaceId,
          principalId: entityId,
          reason,
          buildEvent: ({ removed }: { removed: PurgeCounts }, { reason: builtReason } = {}): DomainEvent => ({
            id: idGen.next(),
            name: "identity.user.deleted",
            occurredAt: clock.nowIso(),
            aggregateId: entityId,
            workspaceId,
            ...(optional.actor ? { actorId: optional.actor.principalId } : {}),
            payload: { principalId: entityId, username, removed, reason: builtReason },
          }),
        });

        return "purged";
      } });
    },
  };
}

/**
 * Builds the user `TrashAdapter`.
 *
 * @complexity O(1) to build; each method is O(1) plus `purge`'s delegated
 *             `UserPurgePort.purgeUser` cost (itself O(1), see that file).
 */
export function createUserTrashAdapter(required: UserTrashAdapterDeps, _optional: Empty = {}): TrashAdapter {
  return {
    entityType: required.policy.entityType,
    ...userTrashHide(required),
    ...userTrashUnhide(required),
    ...userTrashPurge(required),
  };
}
