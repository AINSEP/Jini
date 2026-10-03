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

export interface TrashChangeEvent {
  workspaceId: string;
  entityType: TrashEntityType;
  entityId: string;
  change: "trash" | "restore" | "purge";
}

export interface TrashServiceDeps {
  repo: TrashRepoPort;

  adapters: ReadonlyMap<TrashEntityType, TrashAdapter>;
  idGen: IdGenerator;
  entityPolicy: TrashEntityPolicy;
  transaction: TransactionRunner;

}

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
  onChanged?: (required: TrashChangeEvent) => void | Promise<void>;
  onError?: (required: { error: unknown }) => void;
}

export class TrashAdapterMissingError extends Error {
  constructor({ message }: { message: string }, optional: { cause?: unknown } = {}) {
    super(message, optional);
  }
}

/** Stamp retention once at removal; later policy changes cannot shorten an existing promise. */
export const DEFAULT_TRASH_RETENTION_DAYS = 60;

export function computePurgeAfter({ at }: { at: string }, optional: { retentionDays?: number } = {}): string {
  const retentionDays = optional.retentionDays ?? DEFAULT_TRASH_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) throw new RangeError("trash retentionDays must be non-negative and finite");
  const base = new Date(at);
  if (Number.isNaN(base.getTime())) {
    throw new RangeError(`trash: 'at' is not a parseable timestamp (received ${JSON.stringify(at)})`);
  }
  return new Date(base.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/** Coordinate both writes through the host's transaction runner; never hydrate entity payloads. */
export function createTrashService(deps: TrashServiceDeps, optional: TrashServiceOptional = {}): TrashPort {
  const retentionDays = optional.retentionDays ?? DEFAULT_TRASH_RETENTION_DAYS;
  computePurgeAfter({ at: "2000-01-01T00:00:00.000Z" }, { retentionDays });

  function requireAdapter(entityType: TrashEntityType): TrashAdapter {
    const adapter = deps.adapters.get(entityType);
    if (!adapter || !deps.entityPolicy({ entityType })) {
      throw new TrashAdapterMissingError({ message: `trash: no adapter is registered for entity type '${entityType}'` });
    }
    return adapter;
  }

  return {

    async trash(required, trashOptional = {}): Promise<TrashMarkerResult> {
      const adapter = requireAdapter(required.entityType);
      return deps.transaction({ work: async () => {
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
      } });
    },

    async restore(required, restoreOptional = {}): Promise<RestoreOutcome> {
      const row = await deps.repo.findByEntity(required);
      if (!row) return "not-found";
      const adapter = deps.adapters.get(required.entityType);
      if (!adapter || !deps.entityPolicy({ entityType: required.entityType })) return "adapter-unavailable";

      return deps.transaction({ work: async () => {
        const marker = await adapter.unhide({
          workspaceId: required.workspaceId,
          entityId: required.entityId,
          at: required.at,
          expectedVersion: row.entityVersion,
        }, { priorMarker: row.priorMarker,
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
      } });
    },

    async list(required, listOptional = {}): Promise<TrashPage> {
      return deps.repo.list(required, listOptional);
    },

    async purgeSelected(required): Promise<PurgeReport> {
      const rows = await deps.repo.findByIds({ workspaceId: required.workspaceId, ids: required.ids });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const results: { id: string; outcome: PurgeItemOutcome }[] = [];

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
        if (!deps.entityPolicy({ entityType: row.entityType })) { results.push({ id, outcome: "forbidden" }); continue; }
        const adapter = deps.adapters.get(row.entityType);
        if (!adapter) {
          results.push({ id, outcome: "adapter-unavailable" });
          continue;
        }
        const outcome = await deps.transaction({ work: async (): Promise<PurgeItemOutcome> => {
          const result = await adapter.purge({
            workspaceId: row.workspaceId,
            entityId: row.entityId,
            expectedVersion: row.entityVersion,
          }, { actor: required.actor });

          if (result === "purged" || result === "already-gone") {
            await deps.repo.deleteById({ workspaceId: row.workspaceId, id: row.id });
          }

          if (result === "purged") {
            await notifyChanged(optional, {
              workspaceId: row.workspaceId,
              entityType: row.entityType,
              entityId: row.entityId,
              change: "purge",
            });
          }
          return result;
        } });
        results.push({ id, outcome });
      }

      return { purged: results.filter((r) => r.outcome === "purged").length, results };
    },
  };
}

/** Bind a domain to the index-only cleanup callback after an independently completed removal. */
export function bindForgetRemovedEntity({ repo, entityType }: { repo: TrashRepoPort; entityType: TrashEntityType }): ForgetRemovedEntity {
  return (required) =>
    repo.deleteByEntity({ workspaceId: required.workspaceId, entityType, entityId: required.id });
}

/** Bind a domain without making its callers depend on trash vocabulary. */
export function bindRemoveEntity({ trash, entityType }: { trash: TrashPort; entityType: TrashEntityType }): RemoveEntity {
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
