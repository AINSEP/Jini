/**
 * @file Core type definitions for the `navigation` library.
 *
 * Purpose:
 * Menus/nav are **navigation trees as editable content**. A menu is a generic
 * content entry (type `menu`); its ordered, nested item tree lives in the
 * entry's validated `bodyJson` as a `navigation`-namespaced block vocabulary.
 * Link targets that point at other content (entries, taxonomy terms) are `ref`
 * values so the write-chokepoint extracts them into the rebuildable
 * `entry_refs` index (where-used + safe-delete), exactly as the media library reuses it
 * for media. External URLs and named routes carry no ref.
 *
 * How it relates to the project:
 * - `core/ports.ts` supplies the shared primitives (`UUID`, `JsonObject`, …).
 * - `navigation/ports.ts` declares the one rule-of-two port this library adds
 *   (`NavLocationBindingRepoPort`) plus the typed-call resolver contract.
 * - The theme renderer consumes `ResolvedNav` (data only — no theme code
 *   resolves refs; the render-IR boundary).
 *
 * Architectural role:
 * INTERFACES + TYPES ONLY (no feature logic). This is the design-frozen shape
 * this library introduces; the entries repo, revisions, `entry_refs`, and the command
 * gateway are reused unchanged from the generic entries model.
 */
import type { ISODateTime, JsonObject, UUID } from "../core/ports.js";

// ---------------------------------------------------------------------------
// Content-type identity
// ---------------------------------------------------------------------------

/**
 * `menu` ships as a **seeded content-type registry row**, like
 * `post`/`page`/`media`. Core may special-case it in admin UI/rendering, never
 * in storage. The extension-field owner namespace for menu-level fields
 * (`fields.ext.navigation.*`) is `navigation`.
 */
export const NAV_MENU_CONTENT_TYPE = "menu" as const;
export const NAV_FIELD_NAMESPACE = "navigation" as const;

/** Discriminator marking an entry's `bodyJson` as a navigation tree document. */
export const NAV_DOC_TYPE = "menu" as const;

// ---------------------------------------------------------------------------
// Link targets
// ---------------------------------------------------------------------------

/**
 * The v1 link-target kinds. `entryRef`/`termRef` are integrity-tracked (their
 * ids are extracted to `entry_refs`); `url`/`route` are validated-only.
 */
export type NavTargetKind = "entryRef" | "termRef" | "url" | "route";

/**
 * Reserved-but-rejected target kinds — the named deferred seams.
 * Recognized by the validator and **rejected with a clear "coming later" error**
 * until their resolver stage ships, so the discriminant never has to widen in a
 * breaking way. `dynamicQuery` needs a total/bounded expression
 * language; `content` needs a mega-menu block-embed resolver.
 */
export type ReservedNavTargetKind = "dynamicQuery" | "content";

/** A link to another content entry (page/post/media/…). Integrity-tracked. */
export interface NavEntryTarget {
  readonly kind: "entryRef";
  /** Target entry id. Extracted to `entry_refs` at the write chokepoint. */
  readonly entryId: UUID;
}

/** A link to a taxonomy term (category/tag archive). Integrity-tracked. */
export interface NavTermTarget {
  readonly kind: "termRef";
  /** Target term id. Extracted to `entry_refs` (target kind = term). */
  readonly termId: UUID;
  /** Taxonomy the term belongs to, for archive-route resolution. */
  readonly taxonomy: string;
}

/** An absolute or site-relative external URL. Validated, not ref-tracked. */
export interface NavUrlTarget {
  readonly kind: "url";
  /** Sanitized/validated at write time (scheme allowlist, no `javascript:`). */
  readonly href: string;
}

/** A named core route (e.g. `home`, `search`), resolved by the routing lib. */
export interface NavRouteTarget {
  readonly kind: "route";
  readonly route: string;
  /** Optional static params passed to the route resolver. */
  readonly params?: JsonObject | undefined;
}

/** v1 discriminated union of link targets. */
export type NavTarget = NavEntryTarget | NavTermTarget | NavUrlTarget | NavRouteTarget;

// ---------------------------------------------------------------------------
// The stored item tree (lives in entry `bodyJson`)
// ---------------------------------------------------------------------------

/**
 * Presentational attributes carried on an item, kept separate from identity and
 * target so the render model can pass them through without interpreting them.
 */
export interface NavItemAttrs {
  readonly openInNewTab?: boolean | undefined;
  /** `rel` tokens (e.g. `nofollow`), validated against an allowlist. */
  readonly rel?: string | undefined;
  /** Theme-facing CSS class hint. */
  readonly cssClass?: string | undefined;
  /** Optional description/subtitle (mega-menu-adjacent, cosmetic in v1). */
  readonly description?: string | undefined;
  /** Icon token resolved by the theme's icon set, if any. */
  readonly icon?: string | undefined;
}

/**
 * One node in the menu tree. **Ordering = array order** among siblings;
 * **nesting = `children`**. `id` is a **stable ULID minted on item creation and
 * preserved across edits/moves** (never regenerated on reorder) — the stable
 * identity `entry_refs` locators and per-item caches depend on (a discipline
 * discipline applied within the doc). The chokepoint validator enforces id
 * stability and bounded depth/breadth.
 */
export interface NavItemNode {
  readonly id: UUID;
  /** Editable display label. Falls back to the target's title when absent. */
  readonly label?: string | undefined;
  readonly target: NavTarget;
  readonly attrs?: NavItemAttrs | undefined;
  /** Child items (one level of nesting per depth). */
  readonly children?: readonly NavItemNode[] | undefined;
}

/**
 * The full navigation document stored in a menu entry's `bodyJson`. Shaped so it
 * satisfies `JsonObject` structurally (all fields are JSON-serializable), which
 * keeps it inside the storage contract and the serializable
 * ABI.
 */
export interface NavMenuDoc {
  readonly type: typeof NAV_DOC_TYPE;
  /** Doc-schema version, so the validator can migrate shapes later. */
  readonly version: number;
  readonly items: readonly NavItemNode[];
}

// ---------------------------------------------------------------------------
// The menu read model (a typed view over the generic entries row)
// ---------------------------------------------------------------------------

export type MenuStatus = "draft" | "published" | "trash";

/**
 * A typed read model over a `type='menu'` entries row (universal
 * columns) plus the parsed `bodyJson` tree and the `navigation`-namespaced
 * fields. This is a **projection**, not a new table — menus are entries.
 */
export interface NavMenuEntry {
  readonly id: UUID;
  readonly workspaceId: UUID;
  /** Stable machine handle, e.g. `primary-nav` (the entry `slug`). */
  readonly slug: string;
  /** Human menu name (the entry `title`). */
  readonly title: string;
  readonly status: MenuStatus;
  /** The parsed navigation tree (entry `bodyJson`). */
  readonly doc: NavMenuDoc;
  /**
   * Theme-location keys this menu is assigned to fill
   * (`fields.ext.navigation.locations`). Source of truth for assignment;
   * the binding index (below) is the derived, uniqueness-enforcing projection.
   */
  readonly locations: readonly string[];
  readonly updatedAt: ISODateTime;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Location binding index (derived, rebuildable — the one new core table)
// ---------------------------------------------------------------------------

/** A theme-registered location key (e.g. `primary`, `footer`, `social`). */
export type NavLocationKey = string;

/**
 * A row of the derived `nav_location_bindings` index.
 * **Derived + rebuildable** from `NavMenuEntry.locations` at the write
 * chokepoint (same species as `entry_refs`), NOT a source of truth
 * and NOT revision-generating. Its purpose is a single indexed location→menu
 * lookup at render time and a **`UNIQUE (workspace_id, location_key)`**
 * constraint that enforces *exactly one menu per location* — an invariant a
 * per-entry JSON field cannot express.
 */
export interface NavLocationBindingRow {
  readonly workspaceId: UUID;
  readonly locationKey: NavLocationKey;
  /** The menu entry currently bound to this location. */
  readonly menuId: UUID;
  /** When the binding was last (re)assigned; for audit/debug only. */
  readonly boundAt: ISODateTime;
}

/**
 * A theme/plugin-registered navigation location (registered via
 * `navigation.locations.register`). Registration is data; a menu may be bound to
 * an **unregistered** key so assignments survive a theme switch (fixes WP's
 * "lose your menus on theme change" sin).
 */
export interface NavLocationDescriptor {
  readonly key: NavLocationKey;
  /** Admin-facing label. */
  readonly label: string;
  /** Which theme/plugin registered it (attribution + orphan detection). */
  readonly registeredBy: string;
  readonly description?: string | undefined;
}

// ---------------------------------------------------------------------------
// The resolved render model (data handed to themes)
// ---------------------------------------------------------------------------

/**
 * A single item after resolution: target → concrete `href` + display `label` +
 * `isActive`/`isCurrent` computed against the current route. Refs are resolved
 * by core (routing/entries/taxonomy), never by theme code. Items whose target
 * has been trashed/deleted are resolved to `available: false` so the theme can
 * omit them rather than emit a dead link.
 */
export interface ResolvedNavItem {
  readonly id: UUID;
  readonly label: string;
  /** Fully-resolved href, or `null` when the target is unavailable. */
  readonly href: string | null;
  readonly available: boolean;
  /** True when this item's href matches the current route. */
  readonly isCurrent: boolean;
  /** True when this or a descendant is current (for open/expanded state). */
  readonly isActive: boolean;
  readonly attrs?: NavItemAttrs | undefined;
  readonly children: readonly ResolvedNavItem[];
}

/** A fully-resolved menu ready for a theme to render at a location. */
export interface ResolvedNav {
  readonly menuId: UUID;
  readonly locationKey: NavLocationKey;
  readonly title: string;
  readonly items: readonly ResolvedNavItem[];
}
