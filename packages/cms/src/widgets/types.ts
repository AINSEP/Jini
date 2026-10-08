/**
 * @file Core type definitions for the Tovu `widgets` library (ADR-047, SPEC-043).
 *
 * Purpose:
 * Widgets are placeable, reusable, individually-configured components (a contact
 * form, a recent-posts list, a text block, social links, a menu) placed either
 * into a theme-declared region (an ordered list, backed by a seeded
 * `widget_area` entry) or embedded inline inside a page's rich-text body (a
 * `widgetEmbed` TipTap node). A widget instance is a seeded ADR-022 content
 * entry (type `widget`), exactly as a menu is (ADR-029) — this file mirrors
 * `navigation/types.ts` deliberately, per the ADR-047 debate's finding that the
 * region-binding mechanism must structurally match `nav_location_bindings`
 * (source-of-truth-on-the-entry + a derived, reconciled binding index), not
 * merely resemble it.
 *
 * How it relates to the project:
 * - `core/ports.ts` supplies the shared primitives (`UUID`, `JsonObject`, …).
 * - `widgets/ports.ts` declares the one rule-of-two port this library adds
 *   (`WidgetRegionBindingRepoPort`, mirroring `NavLocationBindingRepoPort`).
 * - `widgets/registry.ts` declares the v1 widget-type registry as plain data —
 *   see that file for why type *registration* and type *behavior* are split.
 * - The theme renderer never resolves a widget reference itself (ADR-020 §7 /
 *   ADR-029 §7's "theme receives resolved data" boundary, unchanged here).
 *
 * Architectural role:
 * INTERFACES + TYPES ONLY (no feature logic). This is the design-frozen shape
 * ADR-047 (as amended by its 2026-07-21 debate fold-in) introduces; the entries
 * repo, revisions, and the command gateway are reused unchanged from ADR-022 /
 * ADR-008.
 */
import type { ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";

// ---------------------------------------------------------------------------
// Content-type identity
// ---------------------------------------------------------------------------

/** `widget` ships as a seeded content-type registry row (ADR-022 §1), like `post`/`page`/`menu`. */
export const WIDGET_CONTENT_TYPE = "widget" as const;

/**
 * `widget_area` ships as a seeded, **system-managed** content-type registry
 * row — never publicly routable, never itself placeable as a widget, never a
 * valid `widgetEmbed` target (REQ-17 — no recursion into a region from inside
 * a region).
 */
export const WIDGET_AREA_CONTENT_TYPE = "widget_area" as const;

/** The extension-field owner namespace for widget-level fields (`fields.ext.widget.*`). */
export const WIDGET_FIELD_NAMESPACE = "widget" as const;

/** The extension-field owner namespace for a `widget_area` entry's region assignment. */
export const WIDGET_AREA_FIELD_NAMESPACE = "widgets" as const;

// ---------------------------------------------------------------------------
// Widget-type registry (data — see registry.ts for the registration/behavior split)
// ---------------------------------------------------------------------------

/**
 * The v1 widget-type keys (SPEC-043 REQ-09). Kept as a closed union rather than
 * a bare `string` so a typo in a registration or a call site is a compile error,
 * not a runtime `unknown-type` surprise.
 */
export type WidgetTypeKey = "text" | "social-links" | "recent-entries" | "menu" | "contact-form";

/**
 * A widget type's declared capability class (ADR-047 Debate Fold-In Amendment
 * 3). `static` types render validated config directly with no resolver;
 * `query`/`form`/`entry-reference` types have a registered resolver in the
 * closed `CORE_RESOLVERS` map (`resolvers/index.ts`).
 */
export type WidgetCapability = "static" | "query" | "form" | "entry-reference";

/** Where a widget type may legally be placed. */
export type WidgetPlacementContext = "region" | "inline";

/**
 * A widget type's **registration** — plain, JSON-serializable data (SPEC-043
 * REQ-07). Never imports or references executable behavior; the only pointer
 * to code this record carries is `resolverId`, which must resolve *only*
 * through the closed `CORE_RESOLVERS` map (REQ-08) — never a module path,
 * function name, query string, or expression.
 */
export interface WidgetTypeRegistration {
  readonly typeKey: WidgetTypeKey;
  readonly capability: WidgetCapability;
  /** JSON-Schema-shaped description of `fields.ext.widget.*`'s valid shape for this type. */
  readonly configSchema: JsonObject;
  readonly placementContexts: readonly WidgetPlacementContext[];
  /** Cost clamps enforced by core at the orchestration layer, never by the resolver's own discipline (REQ-25). */
  readonly clamps: {
    readonly maxItems?: number;
    readonly timeoutMs: number;
  };
  /** `undefined` for `static`-capability types (REQ-10). Indexes into `CORE_RESOLVERS` only. */
  readonly resolverId?: string;
}

// ---------------------------------------------------------------------------
// The widget instance (a typed view over an ADR-022 `entries` row)
// ---------------------------------------------------------------------------

/**
 * `purged` is observably distinct from `trash` (REQ-43): both are treated identically everywhere a
 * widget instance's availability is checked (resolution, placement validation — see
 * `resolver-service.ts`/`region-area-service.ts`), but only `purged` records that the instance was
 * force-deleted past a known reference (`purgeWidgetInstance({ force: true })`), vs. an ordinary
 * `trash` that may still be restored with no prior reference conflict. No real hard-delete exists in
 * this codebase for any content type (`EntryRepoPort` has no delete method) — this status is the
 * cheap, in-model way to keep that distinction visible without one.
 *
 * No `draft` member (Fable adversarial-review fix, 2026-07-21, Finding F) — `write-service.ts`
 * creates every widget instance directly as `active`; nothing anywhere in this codebase ever writes
 * `draft`. A prior version of this union carried it anyway, which was a live landmine: the
 * resolver/placement-validation skip lists above only ever checked for `trash`/`purged`, so a
 * `draft` status — had anything ever produced one — would have rendered publicly instead of being
 * held back. Removed rather than defensively added to the skip lists, since there is no real
 * "draft" concept for widget instances to guard.
 */
export type WidgetInstanceStatus = "active" | "trash" | "purged";

/**
 * A typed read model over a `type='widget'` entries row (ADR-022 §2 universal
 * columns) plus the parsed `fields.ext.widget.*` config bag. A projection, not
 * a new table — widget instances are entries (REQ-01).
 */
export interface WidgetInstanceEntry {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly slug: string;
  readonly title: string;
  readonly status: WidgetInstanceStatus;
  readonly widgetType: WidgetTypeKey;
  /** Validated against the type's registered `configSchema` on every write (REQ-02). */
  readonly config: JsonObject;
  readonly updatedAt: ISODateTime;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Region composition (a typed view over a `widget_area` entry)
// ---------------------------------------------------------------------------

/** A theme-registered region key (e.g. `header`, `footer`, `sidebar`). */
export type WidgetRegionKey = string;

/** One entry in a `widget_area`'s ordered placement list (lives in the area entry's `bodyJson`). */
export interface WidgetPlacementNode {
  /** Stable ULID, minted once, preserved across reorders — for diagnostics and `entry_refs` locators. */
  readonly placementId: UUID;
  readonly widgetEntryId: UUID;
  readonly enabled: boolean;
}

/** The full region-composition document stored in a `widget_area` entry's `bodyJson`. */
export interface WidgetAreaDoc {
  readonly schemaVersion: number;
  readonly placements: readonly WidgetPlacementNode[];
}

/**
 * A typed read model over a `type='widget_area'` entries row. `regionKey` is
 * the **source of truth** for which region this area fills
 * (`fields.ext.widgets.regionKey`) — mirrors `NavMenuEntry.locations` exactly
 * (ADR-047 Debate Fold-In Amendment 1).
 */
export interface WidgetAreaEntry {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly regionKey: WidgetRegionKey;
  readonly doc: WidgetAreaDoc;
  readonly updatedAt: ISODateTime;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Region binding index (derived, rebuildable — the one new widgets-owned table)
// ---------------------------------------------------------------------------

/**
 * A row of the derived `widget_region_bindings` index. **Derived + rebuildable**
 * from `WidgetAreaEntry.regionKey` at the write chokepoint (same species as
 * `nav_location_bindings` and ADR-022 §5 `entry_refs`), NOT a source of truth
 * and NOT revision-generating (INV-02). Reconciled by exactly one code path
 * (`region-area-service.ts`'s `reconcileWidgetRegionBindings`) — never
 * hand-authored.
 */
export interface WidgetRegionBindingRow {
  readonly workspaceId: UUID;
  readonly regionKey: WidgetRegionKey;
  readonly areaEntryId: UUID;
  readonly updatedAt: ISODateTime;
}

/** A theme/plugin-registered widget region (mirrors `NavLocationDescriptor`). */
export interface WidgetRegionDescriptor {
  readonly key: WidgetRegionKey;
  readonly label: string;
  readonly registeredBy: string;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Inline embed (a node inside any entry's TipTap `bodyJson`)
// ---------------------------------------------------------------------------

/**
 * The `widgetEmbed` node's persisted shape. A block-level atom (REQ-18) — never
 * nested inside a widget instance's own `bodyJson` (REQ-19, INV-04), enforced
 * by `embed-validation.ts`'s `validateWidgetEmbedMutation`, the single
 * validator both the live-editor path and the server-side/AI path call.
 */
export interface WidgetEmbedNode {
  readonly type: "widgetEmbed";
  readonly placementId: UUID;
  readonly widgetEntryId: UUID;
}

// ---------------------------------------------------------------------------
// Resolution (the render-time contract — Debate Fold-In Amendment 2)
// ---------------------------------------------------------------------------

/** The internal render IR node shape every resolved widget produces (ADR-020's canonical render IR). */
export interface WidgetRenderIR {
  readonly componentId: string;
  readonly props: JsonObject;
  readonly children?: readonly WidgetRenderIR[];
}

/** Context passed to a resolver for one page render (REQ-23). */
export interface WidgetResolveContext {
  readonly workspaceId: UUID;
  readonly locale?: string;
  readonly preview: boolean;
}

/** A minimal, read-only view of a widget instance passed into a resolver — never a raw DB handle (SPEC-043's REQ-24 batching contract). */
export interface WidgetInstanceView {
  readonly id: UUID;
  readonly widgetType: WidgetTypeKey;
  readonly config: JsonObject;
}

/** Why a widget resolution failed (SPEC-043 REQ-27's closed failure taxonomy). */
export type WidgetResolveFailureReason =
  | "unknown-type"
  | "invalid-config"
  | "target-disabled"
  | "timeout"
  | "resolver-error";

export type WidgetResolveResult =
  | { readonly ok: true; readonly ir: WidgetRenderIR; readonly dependencyKeys: readonly string[] }
  | { readonly ok: false; readonly reason: WidgetResolveFailureReason };

/**
 * The typed resolver contract every dynamic (non-`static`) widget type
 * implements (REQ-23/24). **Batch-first by design** — `resolveMany` is called
 * at most once per type per page render (REQ-24), never once per placement, so
 * N+1 query cost is a contract violation, not an optimization opportunity.
 */
export interface WidgetResolver {
  resolveMany(
    instances: readonly WidgetInstanceView[],
    context: WidgetResolveContext
  ): Promise<ReadonlyMap<UUID, WidgetResolveResult>>;
}
