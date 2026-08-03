import type { EntryRepoPort, EntryRevisionInput, OutboxPort } from "./write-service.js";
import type { EntryListPort } from "./list.js";
import type { EntryRecord, EntryStatus } from "./types.js";

/**
 * @file In-memory `EntryRepoPort` + `EntryListPort` double (same disclosed rule-of-two-until-a-
 * real-adapter-exists precedent as `features/content-types/repo.memory.ts` — see that file's
 * header for the full disclosure, which applies identically here).
 */
export class InMemoryEntryRepo implements EntryRepoPort, EntryListPort {
  private readonly byId = new Map<string, EntryRecord>();
  private readonly revisions: EntryRevisionInput[] = [];

  private static slugKey(workspaceId: string, type: string, slug: string): string {
    return `${workspaceId}::${type}::${slug}`;
  }

  async findBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<EntryRecord | null> {
    const target = InMemoryEntryRepo.slugKey(params.workspaceId, params.type, params.slug);
    for (const row of this.byId.values()) {
      if (InMemoryEntryRepo.slugKey(row.workspaceId, row.type, row.slug) === target) return { ...row };
    }
    return null;
  }

  async findById(params: { workspaceId: string; id: string }): Promise<EntryRecord | null> {
    const row = this.byId.get(params.id);
    return row && row.workspaceId === params.workspaceId ? { ...row } : null;
  }

  async save(row: EntryRecord): Promise<void> {
    this.byId.set(row.id, { ...row });
  }

  async appendRevision(revision: EntryRevisionInput): Promise<void> {
    this.revisions.push(revision);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async listByWorkspace(params: {
    workspaceId: string;
    type?: string;
    status?: EntryStatus;
    orderBy?: "updatedAt";
    orderDirection?: "asc" | "desc";
    limit?: number;
  }): Promise<EntryRecord[]> {
    let rows = [...this.byId.values()]
      .filter((row) => row.workspaceId === params.workspaceId)
      .filter((row) => !params.type || row.type === params.type)
      .filter((row) => !params.status || row.status === params.status);

    if (params.orderBy === "updatedAt") {
      const dir = params.orderDirection === "asc" ? 1 : -1;
      rows = rows.sort((a, b) => (a.updatedAt < b.updatedAt ? -dir : a.updatedAt > b.updatedAt ? dir : 0));
    }
    if (typeof params.limit === "number") {
      rows = rows.slice(0, params.limit);
    }
    return rows.map((row) => ({ ...row }));
  }
}

/** Adapts a real `core/ports` `OutboxPort` into the narrower `{enqueue({name,payload})}` shape
 * `entries/write-service.ts` declares locally — same pattern as
 * `features/content-types/repo.memory.ts`'s `toContentTypeOutbox`.
 *
 * `workspaceId` is REQUIRED and is declared on the wrapped port's event type on purpose. A real
 * `core/ports` `DomainEvent` carries `workspaceId` as a non-optional tenant boundary (ADR-007), and
 * persistent adapters store it in a NOT NULL column. This wrapper previously under-declared the
 * wrapped port as `{id,name,occurredAt,payload}` and constructed an event without `workspaceId`, so
 * a host binding a SQLite outbox typechecked cleanly and then threw
 * `NOT NULL constraint failed: outbox_events.workspace_id` on every write. Sourcing it from `deps`
 * rather than from `event.payload` is deliberate: the narrow local port carries only `{name,payload}`
 * and payload contents are per-event convention, not a contract. */
export function toEntryOutbox(deps: {
  outbox: {
    enqueue(event: {
      id: string;
      workspaceId: string;
      name: string;
      occurredAt: string;
      payload: Record<string, unknown>;
    }): Promise<void>;
  };
  clock: { nowIso(): string };
  idGen: { newId(): string };
  workspaceId: string;
}): OutboxPort {
  return {
    enqueue: async (event) => {
      await deps.outbox.enqueue({
        id: deps.idGen.newId(),
        workspaceId: deps.workspaceId,
        name: event.name,
        occurredAt: deps.clock.nowIso(),
        payload: event.payload,
      });
    },
  };
}
