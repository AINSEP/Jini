import type { ContentLookupPort, EntryTermRepoPort, TaxonomyRepoPort, TaxonomyRevisionRepoPort, TaxonomyRevisionRow, Term, TermRepoPort } from "./write-service.js";
import type { Taxonomy } from "./write-service.js";
import type { TaxonomyListPort, TermListPort } from "./list.js";

/**
 * @file In-memory adapters for the `taxonomy` package's write/list ports — same disclosed
 * rule-of-two-until-a-real-adapter-exists precedent as `features/content-types/repo.memory.ts`.
 */

export class InMemoryTaxonomyRepo implements TaxonomyRepoPort, TaxonomyListPort {
  private readonly rows = new Map<string, Taxonomy>();

  async insert(row: Taxonomy): Promise<unknown> {
    this.rows.set(row.id, { ...row });
    return row;
  }

  async findById(id: string): Promise<{ id: string; hierarchical: boolean; allowList?: string[] | undefined } | null> {
    const row = this.rows.get(id);
    return row ? { id: row.id, hierarchical: row.hierarchical } : null;
  }

  async list(): Promise<Taxonomy[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}

export class InMemoryTermRepo implements TermRepoPort, TermListPort {
  private readonly rows = new Map<string, Term>();

  async insert(row: Term): Promise<unknown> {
    this.rows.set(row.id, { ...row });
    return row;
  }

  async update(row: Term): Promise<unknown> {
    this.rows.set(row.id, { ...row });
    return row;
  }

  async findById(id: string): Promise<{ id: string; taxonomyId: string; name?: string | undefined } | null> {
    const row = this.rows.get(id);
    return row ? { id: row.id, taxonomyId: row.taxonomyId, name: row.name } : null;
  }

  async listByTaxonomy(params: { taxonomyId: string }): Promise<Term[]> {
    return [...this.rows.values()].filter((row) => row.taxonomyId === params.taxonomyId).map((row) => ({ ...row }));
  }

  /** Ancestor-chain lookup for `validation-chain.ts`'s `wouldCreateCycle` — not required by any
   * currently-wired route (reparent has no route this pass, design-spec.md §2.8), kept here so a
   * future reparent route has a ready-made `TermTreeLookup` to inject. */
  getParentId(termId: string): string | null {
    return this.rows.get(termId)?.parentId ?? null;
  }
}

export class InMemoryEntryTermRepo implements EntryTermRepoPort {
  private readonly rows: Array<{ contentType: string; contentId: string; termId: string; addedAt: string }> = [];

  async upsert(row: { contentType: string; contentId: string; termId: string; addedAt: string }): Promise<unknown> {
    const existingIndex = this.rows.findIndex(
      (r) => r.contentType === row.contentType && r.contentId === row.contentId && r.termId === row.termId
    );
    if (existingIndex >= 0) {
      this.rows[existingIndex] = row;
    } else {
      this.rows.push(row);
    }
    return row;
  }

  async deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }): Promise<number> {
    const before = this.rows.length;
    const remaining = this.rows.filter((r) => !(r.contentType === params.contentType && r.contentId === params.contentId));
    this.rows.length = 0;
    this.rows.push(...remaining);
    return before - this.rows.length;
  }

  /** Mirrors `SqliteEntryTermRepo.countOverlap` — see that method's doc comment for the full
   * rationale (an additive capability beyond the certified `EntryTermRepoPort`, needed by the
   * `mergeTerm` gated-mutation composition this dispatch wires). */
  async countOverlap(params: { fromTermId: string; intoTermId: string }): Promise<number> {
    const fromKeys = new Set(
      this.rows.filter((r) => r.termId === params.fromTermId).map((r) => `${r.contentType}::${r.contentId}`)
    );
    return this.rows.filter((r) => r.termId === params.intoTermId && fromKeys.has(`${r.contentType}::${r.contentId}`)).length;
  }

  /** Mirrors `SqliteEntryTermRepo.repointTerm`. */
  async repointTerm(params: { fromTermId: string; intoTermId: string }): Promise<{ repointedCount: number }> {
    const fromRows = this.rows.filter((r) => r.termId === params.fromTermId);
    for (const row of fromRows) {
      await this.upsert({ contentType: row.contentType, contentId: row.contentId, termId: params.intoTermId, addedAt: row.addedAt });
    }
    const remaining = this.rows.filter((r) => r.termId !== params.fromTermId);
    this.rows.length = 0;
    this.rows.push(...remaining);
    return { repointedCount: fromRows.length };
  }
}

export class InMemoryTaxonomyRevisionRepo implements TaxonomyRevisionRepoPort {
  readonly rows: TaxonomyRevisionRow[] = [];

  async insert(row: TaxonomyRevisionRow): Promise<unknown> {
    this.rows.push(row);
    return row;
  }
}

/**
 * In-memory `ContentLookupPort` — test-friendly, keyed by `(contentType, contentId)`, no real
 * `posts` table backing it. Seed content into `rows` directly (or via the constructor) before a
 * test exercises `assignTerms`'s content-join validation (Finding 1 fix,
 * TM-adr041-043-044-045-audit-001).
 */
export class InMemoryContentLookup implements ContentLookupPort {
  private readonly rows: Map<string, { workspaceId: string; kind: string }>;

  constructor(seed: Array<{ contentType: string; contentId: string; workspaceId: string; kind: string }> = []) {
    this.rows = new Map(seed.map((s) => [`${s.contentType}::${s.contentId}`, { workspaceId: s.workspaceId, kind: s.kind }]));
  }

  set(contentType: string, contentId: string, value: { workspaceId: string; kind: string }): void {
    this.rows.set(`${contentType}::${contentId}`, value);
  }

  async resolve(params: { contentType: string; contentId: string }): Promise<{ workspaceId: string; kind: string } | null> {
    return this.rows.get(`${params.contentType}::${params.contentId}`) ?? null;
  }
}

/** No-op `stampWatermark` — `WriteServiceDeps.stampWatermark` is required (not optional, unlike
 * `content-types`/`entries`' own watermark ports), but this package has no SQLite adapter yet
 * (this file's header) so there is no real watermark row to advance. Disclosed stand-in, not a
 * silently-wrong implementation of a real capability. */
export function noopStampWatermark(): void {}

/** Adapts a real `core/ports` `OutboxPort` into the loose `{enqueue(event: unknown)}` shape
 * `taxonomy/write-service.ts` declares locally. That package's own event objects already carry
 * `name`/`occurredAt` at their top level (unlike `content-types`/`entries`' nested-`payload`
 * shape), so this wrapper forwards them as the full event payload rather than re-nesting. */
export function toTaxonomyOutbox(deps: {
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
  /** Required — see `entries/repo.memory.ts`'s `toEntryOutbox` for the full rationale. Taxonomy is
   * the case that rules out reading the tenant off the event: its own event objects
   * (`{name, taxonomyId, actorId, occurredAt}`) carry no `workspaceId` at all. */
  workspaceId: string;
}): { enqueue: (event: unknown) => Promise<void> } {
  return {
    enqueue: async (event) => {
      const record = event as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "taxonomy.event";
      const occurredAt = typeof record.occurredAt === "string" ? record.occurredAt : deps.clock.nowIso();
      await deps.outbox.enqueue({ id: deps.idGen.newId(), workspaceId: deps.workspaceId, name, occurredAt, payload: record });
    },
  };
}
