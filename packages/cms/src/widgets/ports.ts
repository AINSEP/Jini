/**
 * @file Ports + typed-call contracts for the host `widgets` library (ADR-047, SPEC-043).
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

/**
 * One row of the derived reference index: the source content object refers to a target at `fieldPath`.
 * Rows are extracted and replaced in the same transaction as the source write, never by a follow-up job,
 * and the index can be rebuilt from live entries at any time. Safe-delete's where-used check reads it.
 * `extractEntryRefs`/`extractHtmlEntryRefs` (`entry-refs-extractor.ts`) extract rows; the host persists them.
 */
export interface EntryRefRow {
  readonly workspaceId: UUID;
  readonly sourceEntryId: UUID;
  /**
   * Where the reference sits: `widget-area-placement` (a `widget_area` entry's `bodyJson.placements`),
   * `widget-embed` (a `widgetEmbed` node anywhere in a `bodyJson`), `config-field` (a ref-typed field in a
   * widget instance's `fields.ext.widget.*` config), `page-html-embed` (a `data-embed-type` marker in an
   * html-format page body: a plain HTML string written outside the entries write path, hence its own kind).
   */
  readonly sourceKind: "widget-area-placement" | "widget-embed" | "config-field" | "page-html-embed";
  /** JSON-path-shaped locator within the source (e.g. `bodyJson.placements[2]`, `fields.ext.widget.config.formDefinitionId`). */
  readonly fieldPath: string;
  /**
   * `entry` (a durable content object), `term` (a taxonomy term; narrower, soft coverage) or `asset`
   * (a media asset: a different storage domain from entries, so it gets its own kind rather than overloading `entry`).
   */
  readonly targetKind: "entry" | "term" | "asset";
  readonly targetId: UUID;
}

/** Persistence of the reference index; the host implements it (`InMemoryEntryRefsRepo` is the in-memory one). */
export interface EntryRefsRepoPort {
  /**
   * Replace every row for a given source entry with the freshly-extracted set (idempotent re-extraction
   * on every write, never an incremental patch).
   * Widgets uses only replaceForSource from this repository and delegates extraction to the host.
   */
  replaceForSource(required: { workspaceId: UUID; sourceEntryId: UUID; refs: readonly EntryRefRow[] }): Promise<void>;
  /** Every reference originating FROM a given source entry (re-extraction on update). */
  findBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<EntryRefRow[]>;
  /** Where-used: every reference pointing AT a given target (the disclosure and the safe-delete check). */
  findByTarget(required: { workspaceId: UUID; targetKind: EntryRefRow["targetKind"]; targetId: UUID }): Promise<EntryRefRow[]>;
  /** Drop every row for a source entry (the source itself was force-purged). */
  removeBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<void>;
  /** Full rebuild for a workspace from live entries: the index is derived and rebuildable by definition. */
  rebuildForWorkspace(required: { workspaceId: UUID; refs: readonly EntryRefRow[] }): Promise<void>;
}
