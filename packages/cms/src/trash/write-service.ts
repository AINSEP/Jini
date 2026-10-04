/**
 * @file The Trash write chokepoint (design §2.2).
 *
 * The one thing to understand before editing: **`trash` performs BOTH writes — the domain's marker
 * flip and the `trashed_items` index insert — inside a single transaction.** The design as first
 * written had the caller do two writes (`port.trash()` then `adapter.hide()`), and nothing made
 * them atomic; a failure between them leaves an item that is in the Trash *and still live on the
 * site*, or hidden with no Trash row, which is unrecoverable through the UI. Removing that seam is
 * the point of this module, so there is deliberately no exported way to perform half of it.
 *
 * Domains do not import this file. They receive {@link RemoveEntity} through their own dependency
 * object, pre-bound at the composition root with their `entityType` — see `bindRemoveEntity`.
 */
import type { IdGenerator } from "@jini-ai/core/primitives";
import type {
  ForgetRemovedEntity,
  PurgeItemOutcome,
  PurgeReport,
  RemoveEntity,
  RestoreOutcome,
  TrashAdapter,
  TrashEntityType,
  TrashEntityPolicy,
  TrashItem,
  TrashMarkerResult,
  TrashPage,
  TrashPort,
  TrashRepoPort,
  TransactionRunner,
} from "./ports.js";

/** What {@link TrashServiceOptional.onChanged} receives. One event per state change — a no-op outcome
 *  (`not-found`, `version-changed`, `already-gone`, `forbidden`, `adapter-unavailable`) never fires
 *  it, because nothing changed. */
export interface TrashChangeEvent {
  workspaceId: string;
  entityType: TrashEntityType;
  entityId: string;
  change: "trash" | "restore" | "purge";
}

export interface TrashServiceDeps {
  repo: TrashRepoPort;
  /**
   * Plain `Map`, built at the composition root, resolved on EVERY call — never a module-level
   * registry. This codebase's registries are append-only with no unregister, so any filtering done
   * at registration time runs exactly once (two real bugs already).
     */
  adapters: ReadonlyMap<TrashEntityType, TrashAdapter>;
  idGen: IdGenerator;
  entityPolicy: TrashEntityPolicy;
  transaction: TransactionRunner;

}

/**
 * Calls `optional.onChanged`, if present, and never lets it throw. See
 * {@link TrashServiceOptional.onChanged} for why a failure here must not propagate.
 *
 * @complexity O(1) beyond the hook itself.
 */
async function notifyChanged(optional: TrashServiceOptional, event: TrashChangeEvent): Promise<void> {
  if (!optional.onChanged) return;
  try {
    await optional.onChanged(event);
  } catch (error) {

    try { optional.onError?.({ error }); } catch { /* reporting never undoes a state transition */ }
  }
}

/** Notifications are best effort inside the operation; transactional follow-ups use withFollowUps. */
export interface TrashServiceOptional {
  /** Retention is stamped once when removed; defaults to 60 days. */
  retentionDays?: number;
  /**
   * Fires inside the same transaction after successful marker/index changes. Hosts may stamp a
   * recovery watermark and enqueue an outbox event here; per-type revisions/events use follow-ups.
   * Failures are reported and swallowed so notification failure cannot undo the completed writes.
   */
  onChanged?: (required: TrashChangeEvent) => void | Promise<void>;
  onError?: (required: { error: unknown; }) => void;
}

/** A host composition error: fail fast rather than hide an entity that can never be restored. */
export class TrashAdapterMissingError extends Error {
  constructor({ message }: { message: string; }, optional: { cause?: unknown; } = {}) {
    super(message, optional);
  }
}

/** Stamp retention once at removal; later policy changes cannot shorten an existing promise. */
export const DEFAULT_TRASH_RETENTION_DAYS = 60;

/**
 * `at` + {@link DEFAULT_TRASH_RETENTION_DAYS}, as an ISO timestamp.
 *
 * Stamped at trash time, not computed at read time, so changing the constant later never
 * retroactively purges what a user was already promised.
 *
 * @complexity O(1).
 */
export function computePurgeAfter({ at }: { at: string; }, optional: { retentionDays?: number; } = {}): string {
  const retentionDays = optional.retentionDays ?? DEFAULT_TRASH_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) throw new RangeError("trash retentionDays must be non-negative and finite");
  const base = new Date(at);
  if (Number.isNaN(base.getTime())) {
    throw new RangeError(`trash: 'at' is not a parseable timestamp (received ${JSON.stringify(at)})`);
  }
  return new Date(base.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Builds the Trash service.
 *
 * @param deps repo, the call-time adapter map, an id generator and a reentrant transaction runner.
 * @returns the {@link TrashPort} surface. `purgeSelected` requires host-owned human confirmation and per-row authorization.
 * @complexity O(1) to build.
 */
export function createTrashService(deps: TrashServiceDeps, optional: TrashServiceOptional = {}): TrashPort {
  const retentionDays = optional.retentionDays ?? DEFAULT_TRASH_RETENTION_DAYS;
  computePurgeAfter({ at: "2000-01-01T00:00:00.000Z" }, { retentionDays });

  /** Resolved on every call — see {@link TrashServiceDeps.adapters}. @complexity O(1). */
  function requireAdapter(entityType: TrashEntityType): TrashAdapter {
    const adapter = deps.adapters.get(entityType);
    if (!adapter || !deps.entityPolicy({ entityType })) {
      throw new TrashAdapterMissingError({ message: `trash: no adapter is registered for entity type '${entityType}'` });
    }
    return adapter;
  }

  return {
    /**
     * Hides the entity and indexes it as one unit.
     *
     * @complexity O(1) — one marker UPDATE plus one index INSERT, both inside one transaction.
         */
    async trash(required, trashOptional = {}): Promise<TrashMarkerResult> {
      const adapter = requireAdapter(required.entityType);
      return deps.transaction({
        work: async () => {
          const marker = await adapter.hide({
            workspaceId: required.workspaceId,
            entityId: required.entityId,
            at: required.at,
            expectedVersion: required.expectedVersion,
          }, { actor: required.actor });
          if (!marker.ok) return marker;

          const row: TrashItem = {
            id: deps.idGen.newId(),
            workspaceId: required.workspaceId,
            entityType: required.entityType,
            entityId: required.entityId,
            trashedAt: required.at,
            purgeAfter: computePurgeAfter({ at: required.at }, { retentionDays }),
            actorPrincipalId: required.actor.principalId,
            actorPluginId: required.actor.pluginId ?? null,
            displayTitle: required.display.title,
            displaySubtitle: required.display.subtitle ?? null,
            entityVersion: marker.version,

            // The adapter's marker reading wins; caller state only fills in for adapters without one.
            priorMarker: marker.priorMarker ?? trashOptional.priorMarker ?? null,
          };
          await deps.repo.insert({ row });
          await notifyChanged(optional, {
            workspaceId: required.workspaceId,
            entityType: required.entityType,
            entityId: required.entityId,
            change: "trash",
          });
          return marker;
        }
      });
    },
    /**
     * Clears the domain marker and removes the index row, as one unit.
     *
     * An entity whose row was deleted out from under the index returns `"not-found"` and the index
     * row is LEFT IN PLACE — purge is the only path that removes an index row, and the user can
     * still select it there. One deletion path, not two.
     *
     * @complexity O(1).
         */
    async restore(required, restoreOptional = {}): Promise<RestoreOutcome> {
      const row = await deps.repo.findByEntity(required);
      if (!row) return "not-found";
      const adapter = deps.adapters.get(required.entityType);
      if (!adapter || !deps.entityPolicy({ entityType: required.entityType })) return "adapter-unavailable";

      return deps.transaction({
        work: async () => {
          const marker = await adapter.unhide({
            workspaceId: required.workspaceId,
            entityId: required.entityId,
            at: required.at,
            expectedVersion: row.entityVersion,
          }, {
            priorMarker: row.priorMarker,
            ...(restoreOptional.actor !== undefined ? { actor: restoreOptional.actor } : {}),
          });
          if (!marker.ok) return marker.reason === "not-found" ? "not-found" : "version-changed";
          await deps.repo.deleteById({ workspaceId: required.workspaceId, id: row.id });
          await notifyChanged(optional, {
            workspaceId: required.workspaceId,
            entityType: required.entityType,
            entityId: required.entityId,
            change: "restore",
          });
          return "restored";
        }
      });
    },
    /** @complexity one indexed keyset read; see `TrashRepoPort.list`. */
    async list(required, listOptional = {}): Promise<TrashPage> {
      return deps.repo.list(required, listOptional);
    },
    /**
     * Permanent deletion of selected rows. Called by the admin Trash screen or the assistant's
     * human-confirmed permanent-delete tools; callers own confirmation, this service owns row auth.
     *
     * Per item, and per item only: one unavailable adapter, one stale version or one row the caller
     * may not touch must not abort the rest of the selection, so each row gets its own permission
     * check, its own transaction and its own recorded outcome.
     *
     * The gate runs on the row this method looked up, BEFORE the adapter is resolved: a caller who
     * may not destroy a row must not learn from the outcome whether its domain is still installed.
     *
     * @complexity O(k) authorization calls and at most O(k) transactions for k selected ids.
         */
    async purgeSelected(required): Promise<PurgeReport> {
      const rows = await deps.repo.findByIds({ workspaceId: required.workspaceId, ids: required.ids });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const results: { id: string; outcome: PurgeItemOutcome; }[] = [];

      for (const id of required.ids) {
        const row = byId.get(id);
        if (!row) {
          results.push({ id, outcome: "not-found" });
          continue;
        }
        if (!(await required.authorizeItem({ item: row }))) {
          results.push({ id, outcome: "forbidden" });
          continue;
        }
        const adapter = deps.adapters.get(row.entityType);
        if (!adapter) {
          results.push({ id, outcome: "adapter-unavailable" });
          continue;
        }
        if (!deps.entityPolicy({ entityType: row.entityType })) { results.push({ id, outcome: "forbidden" }); continue; }
        const outcome = await deps.transaction({
          work: async (): Promise<PurgeItemOutcome> => {
            const result = await adapter.purge({
              workspaceId: row.workspaceId,
              entityId: row.entityId,
              expectedVersion: row.entityVersion,
            }, { actor: required.actor });

            // A changed version leaves the index in place: the safe outcome of a restore/edit race
            // is that the item survives. Only completed or already-completed removals drop the index.
            if (result === "purged" || result === "already-gone") {
              await deps.repo.deleteById({ workspaceId: row.workspaceId, id: row.id });
            }

            // Already-gone is a no-op: nothing changed here, so no notification fires.
            if (result === "purged") {
              await notifyChanged(optional, {
                workspaceId: row.workspaceId,
                entityType: row.entityType,
                entityId: row.entityId,
                change: "purge",
              });
            }
            return result;
          }
        });
        results.push({ id, outcome });
      }

      return { purged: results.filter((r) => r.outcome === "purged").length, results };
    },
  };
}

/**
 * Pre-binds an index-row drop to one `entityType`, producing the function a domain receives as
 * `deps.forgetRemoved` (see {@link ForgetRemovedEntity} for when a domain needs one).
 *
 * Binds against the repo rather than the service on purpose: there is no marker to move here, and
 * routing it through `TrashPort` would put a method on that port which does half of a `trash`.
 *
 * @complexity O(1).
 */
export function bindForgetRemovedEntity({ repo, entityType }: { repo: TrashRepoPort; entityType: TrashEntityType; }): ForgetRemovedEntity {
  return (required) =>
    repo.deleteByEntity({ workspaceId: required.workspaceId, entityType, entityId: required.id });
}

/** Bind a domain without making its callers depend on trash vocabulary. */
export function bindRemoveEntity({ trash, entityType }: { trash: TrashPort; entityType: TrashEntityType; }): RemoveEntity {
  return (required, optional = {}) =>
    trash.trash({
      workspaceId: required.workspaceId,
      entityType,
      entityId: required.id,
      actor: required.actor,
      display: required.display,
      at: required.at,
      expectedVersion: required.expectedVersion,

    }, optional);
}
