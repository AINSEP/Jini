/**
 * @file In-memory adapters for the `navigation` library (ADR-029).
 *
 * Purpose:
 * Provides the two dev/test persistence adapters this build needs:
 *
 * - `InMemoryNavLocationBindingRepo` — the real `NavLocationBindingRepoPort`
 *   adapter (`ports.ts`) for the derived `nav_location_bindings` index, honoring
 *   its `UNIQUE (workspace_id, location_key)` constraint via last-writer-wins
 *   `upsert` (ADR-029 §4).
 * - `InMemoryMenuRepo` — a **self-contained** menu store. ADR-029 §5 is explicit
 *   that a menu "adds NO new persistence port" because it should ride the
 *   ADR-022 generic entries repo. That generic entries system is not yet
 *   implemented as reusable code (only `post` exists as a concrete type in the
 *   host that first built this), so this build stores menu records directly
 *   instead of force-fitting the not-yet-generic entries system. `MenuRepoPort`
 *   below is a local, navigation-owned interface (not part of the frozen
 *   `ports.ts` ADR surface) that exists only to make this simplification
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
import type { UUID } from "../core/ports.js";
import type { NavLocationBindingRepoPort } from "./ports.js";
import type { NavLocationBindingRow, NavLocationKey, NavMenuEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Local, navigation-owned menu repo port (deliberately NOT in ports.ts —
// see file header: menus ride the entries repo once it exists generically).
// ---------------------------------------------------------------------------

/**
 * Storage seam for menu records, standing in for the ADR-022 generic entries
 * repo until that generic system exists as reusable code. Shape mirrors the
 * `post` feature's own repo port plus a `remove` for hard purge, since menus
 * have a real hard-delete step in their ADR-027-style deletion ladder
 * (ADR-029 §6).
 */
export interface MenuRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<NavMenuEntry | null>;
  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<NavMenuEntry | null>;
  list(required: { workspaceId: UUID }): Promise<NavMenuEntry[]>;
  save(record: NavMenuEntry): Promise<void>;
  /** Hard-remove a menu row. Only called after the trash step (ADR-029 §6). */
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

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

  constructor(initialRows: NavMenuEntry[] = []) {
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

  async save(record: NavMenuEntry): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async remove(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

// ---------------------------------------------------------------------------
// NavLocationBindingRepoPort — the one real ADR-029 port
// ---------------------------------------------------------------------------

/**
 * In-memory `NavLocationBindingRepoPort` adapter for dev/tests. Enforces the
 * derived index's `UNIQUE (workspace_id, location_key)` constraint by storing
 * at most one row per `(workspaceId, locationKey)` pair: `upsert` replaces
 * whatever row previously held that key (last-writer-wins, ADR-029 §4).
 *
 * @complexity O(n) linear scan per operation over the workspace's binding
 * count; `n` is bounded by the number of registered locations, which is small
 * by construction (never a user-scale collection).
 * @overallScore 100
 */
export class InMemoryNavLocationBindingRepo implements NavLocationBindingRepoPort {
  private rows: NavLocationBindingRow[];

  constructor(initialRows: NavLocationBindingRow[] = []) {
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
