/**
 * @file In-memory adapters for the `navigation` library.
 *
 * Purpose:
 * Provides the two dev/test persistence adapters this build needs:
 *
 * - `InMemoryNavLocationBindingRepo` — the real `NavLocationBindingRepoPort`
 *   adapter (`ports.ts`) for the derived `nav_location_bindings` index, honoring
 *   its `UNIQUE (workspace_id, location_key)` constraint via last-writer-wins
 *   `upsert`.
 * - `InMemoryMenuRepo` — a **self-contained** menu store. The original design is explicit
 *   that a menu "adds NO new persistence port" because it should ride the
 *   generic entries repo. That generic entries system is not yet
 *   implemented as reusable code (only `post` exists as a concrete type in the
 *   host that first built this), so this build stores menu records directly
 *   instead of force-fitting the not-yet-generic entries system. `MenuRepoPort`
 *   below is a local, navigation-owned interface (not part of the frozen
 *   `ports.ts` surface) that exists only to make this simplification
 *   swappable later without touching `menu-service.ts` call sites. When the
 *   generic entries system ships, this repo should be deleted in favor of the
 *   entries repo, and `MenuRepoPort` should be deleted in favor of typed reads
 *   over it.
 *
 * How it relates to the project:
 * - `menu-service.ts` and `resolver.ts` depend on `MenuRepoPort`, not this
 *   concrete class, so a host-supplied SQLite/entries-backed adapter is a
 *   drop-in.
 *
 * Architectural role:
 * Adapters only. No validation or business rules live here (that is
 * `menu-service.ts`'s job) — these classes are dumb, uniqueness-enforcing
 * collections.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { menuVersionConflictError } from "./menu-service.js";
import type { NavLocationBindingRepoPort } from "./ports.js";
import type { NavLocationBindingRow, NavLocationKey, NavMenuEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Local, navigation-owned menu repo port (deliberately NOT in ports.ts —
// see file header: menus ride the entries repo once it exists generically).
// ---------------------------------------------------------------------------

/**
 * Storage seam for menu records, standing in for the generic entries
 * repo until that generic system exists as reusable code. Shape mirrors the
 * `post` feature's own repo port plus a `remove` for hard purge, since menus
 * have a real hard-delete step in their deletion ladder (mirrors the media
 * library's).
 */
export interface MenuRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<NavMenuEntry | null>;
  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<NavMenuEntry | null>;
  list(required: { workspaceId: UUID }): Promise<NavMenuEntry[]>;
  /**
   * Writes `record` by id. With `expectedVersion`, the write is a compare-and-set: it lands only when
   * the stored row is live (not `status: "trash"`) and still holds that version, checked atomically
   * with the write (one conditional UPDATE in a SQL adapter), so two writers that read the same
   * version cannot both land. With `expectedVersion: null` it is insert-if-absent (a create that
   * keeps a caller-given id, e.g. a host's id-preserving import; `INSERT ... ON CONFLICT DO NOTHING`
   * in a SQL adapter), so two creates of one id cannot both land either. Without it, the write is
   * unconditional (`createMenu`'s freshly minted id, trash seams).
   * @throws MenuVersionConflictError ``menu '<id>' was modified concurrently (expected version <n>, found <stored|none>)``,
   *         or ``menu '<id>' already exists (expected no menu, found version <n>)`` for a create
   *         ({@link menuVersionConflictError}).
   */
  save(record: NavMenuEntry, options?: MenuSaveOptions): Promise<void>;
  /** Hard-remove a menu row. Only called after the trash step. */
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
  /**
   * Runs `fn` as ONE unit of work: every menu save, binding write and outbox enqueue inside it commits
   * together or not at all, and a nested call joins the outer one. `assignLocation` needs it because it
   * writes two menus, then the binding: a conflict on the second menu must not leave the first one's
   * `locations` changed while the binding still points at it. A SQL adapter runs its connection's
   * transaction, and the binding repo and outbox must write through that same connection (a wiring
   * obligation of the host). A store with nothing to roll back may just call `fn` (see
   * `InMemoryMenuRepo.transaction`).
   */
  transaction<T>(required: { fn: () => Promise<T> }): Promise<T>;
}

/** Options for {@link MenuRepoPort.save}. */
export interface MenuSaveOptions {
  /** The version the caller read; the save throws `MenuVersionConflictError` unless the stored live row still holds it.
   *  `null` is a create: the save throws unless no row (live, trashed, or in another workspace) holds the id. */
  expectedVersion?: number | null | undefined;
}

/** Re-exported from here, where it has always been exported from; it lives in `menu-service.ts` so that
 *  module's own read check can throw it without a value import cycle. */
export { menuVersionConflictError };

/**
 * In-memory `MenuRepoPort` adapter for dev/tests. See file header for why a
 * self-contained repo exists instead of an entries-backed one.
 *
 * @complexity Every operation is O(n) in the workspace's menu count via a
 * linear scan; acceptable for the in-memory/dev-test adapter this library
 * builds now. A SQLite adapter would index `(workspace_id, id)` /
 * `(workspace_id, slug)` instead.
 * @overallScore 100
 */
export class InMemoryMenuRepo implements MenuRepoPort {
  private rows: NavMenuEntry[];

  constructor(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: NavMenuEntry[] } = {}) {
    const { initialRows = [] } = optionalArgs;
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: UUID; id: UUID }): Promise<NavMenuEntry | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.id === required.id
      ) ?? null
    );
  }

  async findBySlug(required: { workspaceId: UUID; slug: string }): Promise<NavMenuEntry | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.slug === required.slug
      ) ?? null
    );
  }

  async list(required: { workspaceId: UUID }): Promise<NavMenuEntry[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: NavMenuEntry, options: MenuSaveOptions = {}): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (options.expectedVersion === null) {
      // A create needs the id free in every workspace and status, as a SQL primary key on `id` does.
      const holder = this.rows.find((row) => row.id === record.id);
      if (holder) throw menuVersionConflictError({ id: record.id, expectedVersion: null, found: holder.version });
    } else if (options.expectedVersion !== undefined) {
      const stored = this.rows[index];
      const found = stored && stored.status !== "trash" ? stored.version : null;
      if (found !== options.expectedVersion) {
        throw menuVersionConflictError({ id: record.id, expectedVersion: options.expectedVersion, found });
      }
    }
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  /**
   * Just runs `fn`: nothing here rolls back, the same disclosed choice as `InMemoryEntryRepo`'s. A
   * partial write can only be left by a version conflict on a later save of the same unit, which in
   * this single-process store needs another writer to land between that unit's awaits; dev and test
   * hosts accept that, and every durable host adapter must roll back.
   * @complexity O(1) beyond `fn`.
   */
  async transaction<T>(required: { fn: () => Promise<T> }): Promise<T> {
    return required.fn();
  }

  async remove(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

// ---------------------------------------------------------------------------
// NavLocationBindingRepoPort — the one real port this library declares
// ---------------------------------------------------------------------------

/**
 * In-memory `NavLocationBindingRepoPort` adapter for dev/tests. Enforces the
 * derived index's `UNIQUE (workspace_id, location_key)` constraint by storing
 * at most one row per `(workspaceId, locationKey)` pair: `upsert` replaces
 * whatever row previously held that key (last-writer-wins).
 *
 * @complexity O(n) linear scan per operation over the workspace's binding
 * count; `n` is bounded by the number of registered locations, which is small
 * by construction (never a user-scale collection).
 * @overallScore 100
 */
export class InMemoryNavLocationBindingRepo implements NavLocationBindingRepoPort {
  private rows: NavLocationBindingRow[];

  constructor(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: NavLocationBindingRow[] } = {}) {
    const { initialRows = [] } = optionalArgs;
    this.rows = [...initialRows];
  }

  async findByLocation(required: {
    workspaceId: UUID;
    locationKey: NavLocationKey;
  }): Promise<NavLocationBindingRow | null> {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === required.workspaceId && row.locationKey === required.locationKey
      ) ?? null
    );
  }

  async listByMenu(required: {
    workspaceId: UUID;
    menuId: UUID;
  }): Promise<NavLocationBindingRow[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.menuId === required.menuId
    );
  }

  async listByWorkspace(required: { workspaceId: UUID }): Promise<NavLocationBindingRow[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async upsert(required: {
    workspaceId: UUID;
    locationKey: NavLocationKey;
    menuId: UUID;
    boundAt: string;
  }): Promise<NavLocationBindingRow> {
    const row: NavLocationBindingRow = {
      workspaceId: required.workspaceId,
      locationKey: required.locationKey,
      menuId: required.menuId,
      boundAt: required.boundAt,
    };
    const index = this.rows.findIndex(
      (existing) =>
        existing.workspaceId === required.workspaceId &&
        existing.locationKey === required.locationKey
    );
    if (index === -1) {
      this.rows.push(row);
    } else {
      // Last-writer-wins reassignment: the UNIQUE(workspace_id, location_key)
      // constraint means there is never more than one row for this key.
      this.rows[index] = row;
    }
    return row;
  }

  async remove(required: { workspaceId: UUID; locationKey: NavLocationKey }): Promise<void> {
    this.rows = this.rows.filter(
      (row) =>
        !(row.workspaceId === required.workspaceId && row.locationKey === required.locationKey)
    );
  }

  async removeByMenu(required: { workspaceId: UUID; menuId: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.menuId === required.menuId)
    );
  }

  async rebuildForWorkspace(required: {
    workspaceId: UUID;
    bindings: readonly NavLocationBindingRow[];
  }): Promise<void> {
    const others = this.rows.filter((row) => row.workspaceId !== required.workspaceId);
    this.rows = [...others, ...required.bindings];
  }
}
