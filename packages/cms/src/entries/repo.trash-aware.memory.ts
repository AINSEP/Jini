import type { CollectionListQuery, EntryDisplayListPort, EntryListExcludingTypesPort } from "../widgets/resolvers/ports.js";
import { EntrySlugConflictError, VersionConflictError } from "./errors.js";
import type { EntryListPort } from "./list.js";
import type { TrashableEntryRecord } from "./publish-read-port.js";
import { InMemoryEntryRepo } from "./repo.memory.js";
import type { EntryRecord, EntryStatus } from "./types.js";
import type { EntryRepoPort, EntryRevisionInput } from "./write-service.js";

type CollectionSortBy = CollectionListQuery["sort"]["by"];

/**
 * @file The in-memory twin of `repo.sqlite.ts`'s Trash rules, for the hermetic composition
 * (`server/runtime/composition/app.ts`), which has no `content.db`. Wraps the package's
 * `InMemoryEntryRepo` and keeps each trashed row's `deletedAt` beside it:
 *  - every read hides a trashed row;
 *  - `save` leaves a trashed row as it is, and refuses a slug a trashed row holds;
 *  - `findAnyById`/`saveAny` are the trash-blind seam the Trash's record-store adapter flips the
 *    marker through (the SQLite root flips `entries.deleted_at` with the generic table adapter).
 */

/**
 * Reads one custom field's value out of an entry's namespaced `fields.ext.site.<name>` bag — the
 * in-memory twin of `repo.sqlite.ts`'s `json_extract($.ext.site.<name>)`. Unlike the SQLite side,
 * no boolean-to-`1`/`0` conversion is needed here: a JS `boolean`/`number`/`string` compares
 * directly against the same JS type read back from `fieldsJson`, since neither side ever passes
 * through a JSON-in-SQLite round trip.
 *
 * @complexity O(1).
 */
function siteFieldValue({ row, field }: { row: EntryRecord; field: string }, _options = {}): unknown {
  const fields = row.fieldsJson as { ext?: { site?: Record<string, unknown> } } | null | undefined;
  return fields?.ext?.site?.[field];
}

/**
 * Resolves a {@link CollectionSortBy} into the value `listPublishedForDisplay`'s sort compares —
 * the in-memory twin of `repo.sqlite.ts`'s `sortByExpression`.
 *
 * @complexity O(1).
 */
function sortKey(row: EntryRecord, by: CollectionSortBy): unknown {
  if (by === "published") return row.publishedAt;
  if (by === "updated") return row.updatedAt;
  if (by === "title") return row.title;
  return siteFieldValue({ row, field: by.field });
}

/**
 * Orders two arbitrary, possibly-mixed-type sort key values: `null`/`undefined` sort first,
 * same-typed numbers compare numerically (so `9` sorts before `10`, matching SQLite's
 * `json_extract`-returns-typed-values behavior for the SQLite adapter's own numeric fields),
 * everything else compares as a string. Not a general-purpose comparator — scoped to the sort
 * keys {@link sortKey} can produce (an entry's own scalar column values or one JSON field value).
 *
 * @complexity O(1) (O(n) only in the rare cross-type string-coercion branch's implicit
 * `String()` call, n being the value's own serialized length).
 */
function compareSortKeys({ a, b }: { a: unknown; b: unknown }, _options = {}): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aText = String(a);
  const bText = String(b);
  if (aText < bText) return -1;
  if (aText > bText) return 1;
  return 0;
}

/** What a host must supply: the hook is required so a host that caches derived data keyed by this repository cannot forget it. */
export interface TrashAwareMemoryEntryRepoRequired {
  readonly onWriteSettled: (event: { repo: object }) => void;
}

export class TrashAwareInMemoryEntryRepo implements EntryRepoPort, EntryListPort, EntryDisplayListPort, EntryListExcludingTypesPort {
  private readonly inner = new InMemoryEntryRepo();
  /** id → when it was trashed. */
  private readonly deletedAt = new Map<string, string>();
  private readonly onWriteSettled: (event: { repo: object }) => void;

  /** `onWriteSettled` is the host's write-completion hook: it is called with this repository after a `save`, a
   *  `transaction` (in a `finally`), a `saveAny` and a `hardDelete` that removed a row, and never after a read. */
  constructor({ onWriteSettled }: TrashAwareMemoryEntryRepoRequired, _optional: Record<string, never> = {}) {
    this.onWriteSettled = onWriteSettled;
  }

  /** @complexity O(n) over stored entries (the inner repo's scan). */
  async findBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<EntryRecord | null> {
    const row = await this.inner.findBySlug(params);
    return row && !this.deletedAt.has(row.id) ? row : null;
  }

  /** @complexity O(1). */
  async findById(params: { workspaceId: string; id: string }): Promise<EntryRecord | null> {
    const row = await this.inner.findById(params);
    return row && !this.deletedAt.has(row.id) ? row : null;
  }

  /**
   * With `expectedVersion`, the inner repo's compare-and-set decides; a trashed row is a conflict
   * (found none — the same as the SQL repo), not a silent skip, since the inner repo cannot see the Trash.
   * A create (`expectedVersion: null`) goes on to the inner repo, which still holds a trashed row and
   * so refuses its id, as the SQL primary key does.
   * @throws EntrySlugConflictError when a trashed row holds the slug (same text as the SQLite repo).
   * @throws VersionConflictError when the compare-and-set misses or a create finds the id taken.
   * @complexity O(n) over stored entries (one slug scan).
   */
  async save(row: EntryRecord, options: { expectedVersion?: number | null } = {}): Promise<void> {
    if (this.deletedAt.has(row.id) && options.expectedVersion !== null) {
      if (options.expectedVersion === undefined) return;
      throw new VersionConflictError({ message: `expected version ${options.expectedVersion} for entry '${row.id}', found none` });
    }
    const holder = await this.inner.findBySlug({ workspaceId: row.workspaceId, type: row.type, slug: row.slug });
    if (holder && holder.id !== row.id && this.deletedAt.has(holder.id)) {
      throw new EntrySlugConflictError({ message: `an entry with slug '${row.slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug` });
    }
    await this.inner.save(row, options);
    this.onWriteSettled({ repo: this });
  }

  async appendRevision(revision: EntryRevisionInput): Promise<void> {
    await this.inner.appendRevision(revision);
  }

  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    try { return await this.inner.transaction({ fn }); }
    finally { this.onWriteSettled({ repo: this }); }
  }

  /** `limit` applies after trashed rows are dropped, as the SQLite `LIMIT` does.
   *  @complexity O(n log n) over the workspace's entries when ordered. */
  async listByWorkspace(
    required: Parameters<EntryListPort["listByWorkspace"]>[0],
    optional: NonNullable<Parameters<EntryListPort["listByWorkspace"]>[1]> = {}
  ): Promise<EntryRecord[]> {
    const { limit, ...rest } = optional;
    const live = (await this.inner.listByWorkspace(required, rest)).filter((row) => !this.deletedAt.has(row.id));
    return typeof limit === "number" ? live.slice(0, limit) : live;
  }

  /**
   * Review fix 3b — the in-memory twin of `SqliteEntryRepo.listByWorkspaceExcludingTypes`:
   * `excludeTypes` and the trash filter are both applied to the FULL scan before `limit` slices
   * it, so newer system rows can never crowd real content out of a bounded result (the bug this
   * method replaces: the old call site applied its own type filter after `listByWorkspace`'s own
   * `limit` had already run).
   * @complexity O(n log n) over the workspace's live rows when ordered (see `listByWorkspace`).
   */
  async listByWorkspaceExcludingTypes(params: {
    workspaceId: string;
    excludeTypes: readonly string[];
    status?: EntryStatus;
    orderBy?: "updatedAt";
    orderDirection?: "asc" | "desc";
    limit?: number;
  }): Promise<EntryRecord[]> {
    const { workspaceId, excludeTypes, status, orderBy, orderDirection, limit } = params;
    const rows = (await this.inner.listByWorkspace({ workspaceId }, { status, orderBy, orderDirection })).filter(
      (row) => !this.deletedAt.has(row.id) && !excludeTypes.includes(row.type)
    );
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  }

  /** Trash seam: the row whether or not it is trashed. @complexity O(1). */
  async findAnyById(params: { workspaceId: string; id: string }): Promise<TrashableEntryRecord | null> {
    const row = await this.inner.findById(params);
    return row ? { ...row, deletedAt: this.deletedAt.get(row.id) ?? null } : null;
  }

  /** The `(type, slug)` holder whether or not it is trashed. @complexity O(n) (one slug scan). */
  async findAnyBySlug(params: { workspaceId: string; type: string; slug: string }): Promise<TrashableEntryRecord | null> {
    const row = await this.inner.findBySlug(params);
    return row ? { ...row, deletedAt: this.deletedAt.get(row.id) ?? null } : null;
  }

  /** Trash seam: writes the row and its marker as given. @complexity O(1). */
  async saveAny(record: TrashableEntryRecord): Promise<void> {
    const { deletedAt, ...row } = record;
    await this.inner.save(row);
    this.onWriteSettled({ repo: this });
    if (deletedAt === null) this.deletedAt.delete(row.id);
    else this.deletedAt.set(row.id, deletedAt);
  }

  /** Purge seam: delegates physical deletion and forgets the marker only for this workspace.
   * @complexity O(r) over the inner repository's stored revisions. */
  async hardDelete(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<void> {
    if (!(await this.inner.findById(required))) return;
    await this.inner.hardDelete(required);
    this.deletedAt.delete(required.id);
    this.onWriteSettled({ repo: this });
  }

  /**
   * C2 (plan lines 149-167) — the in-memory twin of `SqliteEntryRepo.listPublishedForDisplay`:
   * same filter/sort/limit semantics (published, non-trashed, `query.type`, every `where` clause
   * matched, `query.sort` order with an `id` tiebreak, `query.limit` applied last), reached
   * through this host's own `InMemoryEntryRepo.listByWorkspace` plus the trash filter every other
   * read method here applies, rather than a raw `json_extract` SQL query.
   *
   * @complexity O(n log n) over the workspace+type's live rows: one full scan (bounded by
   * `listByWorkspace`'s own workspace+type filter) plus a JS sort. `n` is never the full table —
   * `InMemoryEntryRepo` only ever backs the hermetic composition root (`server/runtime/
   * composition/app.ts`), which has no real persistence and no production-sized data.
   */
  async listPublishedForDisplay(params: { workspaceId: string; query: CollectionListQuery }): Promise<EntryRecord[]> {
    const { workspaceId, query } = params;
    const rows = (await this.inner.listByWorkspace({ workspaceId }, { type: query.type, status: "published" })).filter(
      (row) => !this.deletedAt.has(row.id)
    );
    const matching = rows.filter((row) => query.where.every((clause) => siteFieldValue({ row, field: clause.field }) === clause.value));

    const direction = query.sort.dir === "asc" ? 1 : -1;
    const sorted = [...matching].sort((a, b) => {
      const primary = compareSortKeys({ a: sortKey(a, query.sort.by), b: sortKey(b, query.sort.by) }) * direction;
      if (primary !== 0) return primary;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    const offset = query.offset ?? 0;
    return sorted.slice(offset, offset + query.limit);
  }
}
