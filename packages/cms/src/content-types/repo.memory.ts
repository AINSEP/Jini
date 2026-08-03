import type { ContentTypeRepoPort, ContentTypeRevisionInput, IndexProvisionerPort, OutboxPort } from "./write-service.js";
import type { TeardownIndexProvisionerPort } from "./lifecycle.js";
import type { ContentTypeListPort } from "./list.js";
import type { ContentTypeRecord } from "./types.js";

/**
 * @file In-memory adapters for the `content-types` package's write/list ports (ADR-006 rule-of-two
 * "one being built now" half). Backs `server/app.ts`'s hermetic test/dev composition AND, until a
 * real SQLite adapter is built for this domain (a disclosed gap — see this dispatch's handoff),
 * `server/deps.ts`'s real running-server composition too — the same precedent `mediaRepo`/
 * `transformDefinitionRepo`/`memberRepo` already establish in both those files (in-process,
 * non-persistent-across-restarts rows are an accepted stand-in until each domain gets its own
 * `repo.sqlite.ts`).
 */

/** In-memory `ContentTypeRepoPort` + `ContentTypeListPort` double, keyed by `(workspaceId, key)`. */
export class InMemoryContentTypeRepo implements ContentTypeRepoPort, ContentTypeListPort {
  private readonly rows = new Map<string, ContentTypeRecord>();
  private readonly revisions: ContentTypeRevisionInput[] = [];

  private static key(workspaceId: string, key: string): string {
    return `${workspaceId}::${key}`;
  }

  async save(row: ContentTypeRecord): Promise<void> {
    this.rows.set(InMemoryContentTypeRepo.key(row.workspaceId, row.key), { ...row });
  }

  async appendRevision(revision: ContentTypeRevisionInput): Promise<void> {
    this.revisions.push(revision);
  }

  /**
   * The append-only revision log, oldest first. Not part of `ContentTypeRepoPort` — the domain only
   * ever appends. Exposed so route-level tests can assert what provenance
   * (`actorId`/`principalKind`) a write actually recorded, which is otherwise unobservable in the
   * hermetic in-memory composition; `SqliteContentTypeRepo`'s equivalent is a plain table read.
   *
   * @complexity O(n) in the number of recorded revisions (defensive copy).
   * @overallScore 100
   */
  listRevisions(): ContentTypeRevisionInput[] {
    return this.revisions.map((revision) => ({ ...revision }));
  }

  async findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null> {
    const row = this.rows.get(InMemoryContentTypeRepo.key(params.workspaceId, params.key));
    return row ? { ...row } : null;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async listByWorkspace(params: { workspaceId: string }): Promise<ContentTypeRecord[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === params.workspaceId).map((row) => ({ ...row }));
  }
}

/** In-memory `IndexProvisionerPort` + `TeardownIndexProvisionerPort` no-op double. Real DDL index
 * provisioning (`index-provisioning.ts`'s CAST-mapping) targets `content.db` tables this domain
 * has no SQLite adapter for yet (see this file's header) — a no-op here is honest given that, not
 * a shortcut around a working implementation. */
export class NoopContentTypeIndexProvisioner implements IndexProvisionerPort, TeardownIndexProvisionerPort {
  async provisionIndexesForNewContentType(): Promise<void> {}
  async applyFieldIndexTransitions(): Promise<void> {}
  async tearDownAllIndexesForContentType(): Promise<void> {}
}

/** Adapts a real `core/ports` `OutboxPort` (`{name,payload}` -> full `DomainEvent`) into the
 * narrower `{enqueue({name,payload})}` shape this package's write-service/lifecycle modules
 * declare locally (mirrors their own "no shared import, kept decoupled" convention). */
export function toContentTypeOutbox(deps: {
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
  /** Required — see `entries/repo.memory.ts`'s `toEntryOutbox` for the full rationale (ADR-007
   * tenant boundary, NOT NULL in persistent adapters, previously under-declared and omitted). */
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
