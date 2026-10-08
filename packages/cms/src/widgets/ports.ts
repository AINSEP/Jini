/**
 * @file Ports + typed-call contracts for the Tovu `widgets` library (ADR-047, SPEC-043).
 *
 * ADR-006 (rule-of-two) applied the way ADR-029 §5 already set precedent:
 *
 * - **`WidgetRegionBindingRepoPort` IS a port.** It persists the derived
 *   `widget_region_bindings` index — two real adapters, in-memory + SQLite,
 *   mirroring `NavLocationBindingRepoPort` exactly.
 *
 * - **Widget instances add NO new persistence port.** A widget instance is an
 *   ADR-022 entry; it rides the existing entries repo (already rule-of-two).
 *
 * - **`widget_area` entries add NO new persistence port either** — same
 *   reasoning, they are entries too (ADR-047 Debate Fold-In Amendment 1).
 *
 * - **Resolution (`WidgetResolver`, `widgets/types.ts`) is NOT a port** — one
 *   evaluator per registered type, dispatched through the closed
 *   `CORE_RESOLVERS` map (`resolvers/index.ts`), not injected. Promote to a
 *   port only if a second real implementation of a given type's resolution
 *   logic appears (ADR-029 §5's anti-port-mania call, applied identically).
 *
 * INTERFACES ONLY. No feature logic lives here.
 */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { WidgetRegionBindingRow, WidgetRegionDescriptor, WidgetRegionKey } from "./types.js";

// ---------------------------------------------------------------------------
// Port: the derived region-binding index (rule-of-two: in-memory + SQLite)
// ---------------------------------------------------------------------------

/**
 * Persistence for the derived `widget_region_bindings` index. Writes happen
 * only inside the same transaction as the `widget_area` entry mutation that
 * changed `regionKey` (single write chokepoint, ADR-022 §4a) — this port is
 * the storage seam, not a second write path. `rebuildForWorkspace` exists
 * because the index is **rebuildable by definition** — a full rescan of
 * `widget_area` entries can always reconstruct it (INV-02).
 */
export interface WidgetRegionBindingRepoPort {
  /** The `widget_area` entry currently bound to a region, if any. */
  findByRegion(required: {
    workspaceId: UUID;
    regionKey: WidgetRegionKey;
  }): Promise<WidgetRegionBindingRow | null>;

  /** Every binding in the workspace (admin overview + render prefetch). */
  listByWorkspace(required: { workspaceId: UUID }): Promise<WidgetRegionBindingRow[]>;

  /**
   * Assign a region to a `widget_area` entry. Honors
   * `UNIQUE (workspace_id, region_key)`. Called only from
   * `region-area-service.ts`'s `reconcileWidgetRegionBindings` — never
   * directly by a route handler or any other caller (INV-02).
   */
  upsert(required: {
    workspaceId: UUID;
    regionKey: WidgetRegionKey;
    areaEntryId: UUID;
    updatedAt: ISODateTime;
  }): Promise<WidgetRegionBindingRow>;

  /** Mark a region binding inactive (theme switch orphaned the region key — REQ-14). Never deletes the underlying `widget_area` entry. */
  markInactive(required: { workspaceId: UUID; regionKey: WidgetRegionKey }): Promise<void>;

  /**
   * Rebuild the whole workspace's index from the authoritative `widget_area`
   * entries. The index is derived + rebuildable, so this is always safe.
   */
  rebuildForWorkspace(required: {
    workspaceId: UUID;
    bindings: readonly WidgetRegionBindingRow[];
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Read-only registry of theme/plugin-declared regions
// ---------------------------------------------------------------------------

/** Registry of theme/plugin-declared widget regions (mirrors `NavLocationRegistry`). */
export interface WidgetRegionRegistry {
  list(required: { workspaceId: UUID }): WidgetRegionDescriptor[];
  get(required: { workspaceId: UUID; key: WidgetRegionKey }): WidgetRegionDescriptor | null;
}

// ---------------------------------------------------------------------------
// The Trash, injected
// ---------------------------------------------------------------------------

/**
 * The function `trashWidgetInstance` receives to move a widget to the Trash, bound to the `"widget"`
 * type at the composition root. Structurally typed on purpose: this feature imports nothing from
 * `features/trash`.
 */
export type RemoveWidgetFn = (required: {
  workspaceId: UUID;
  id: UUID;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
  /** The status a restore brings back, when the Trash cannot read it off a column — only the
   *  legacy-widget adoption states one (`"active"`). */
  priorMarker?: string | null;
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;

/** Structural reference-index row: the host owns extraction and persistence. */
export interface EntryRefRow {
  readonly workspaceId: UUID;
  readonly sourceEntryId: UUID;
  readonly sourceKind: "widget-area-placement" | "widget-embed" | "config-field" | "page-html-embed";
  readonly fieldPath: string;
  readonly targetKind: "entry" | "term" | "asset";
  readonly targetId: UUID;
}

/** The one reference-index operation widgets performs; no extractor implementation is copied. */
export interface EntryRefsRepoPort {
  replaceForSource(required: { workspaceId: UUID; sourceEntryId: UUID; refs: readonly EntryRefRow[] }): Promise<void>;
  findBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<EntryRefRow[]>;
  findByTarget(required: { workspaceId: UUID; targetKind: EntryRefRow["targetKind"]; targetId: UUID }): Promise<EntryRefRow[]>;
  removeBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<void>;
  rebuildForWorkspace(required: { workspaceId: UUID; refs: readonly EntryRefRow[] }): Promise<void>;
}
