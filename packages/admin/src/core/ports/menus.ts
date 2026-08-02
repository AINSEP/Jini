/**
 * @file `AdminMenusPort` — editable navigation trees (menus), and their assignment to named theme
 * locations.
 *
 * ## `AdminMenuTarget` and the content-model leak
 *
 * The reference implementation's own link-target union ties two of its four kinds directly to its
 * content model: `entryRef` points at a content-item id, `termRef` points at a taxonomy-term id plus its
 * taxonomy name. Baking exactly those four kinds into this port as a CLOSED union would mean any
 * host without an "entry"/"taxonomy term" concept (or with additional native reference kinds of
 * its own — a product, a collection, ...) could never express its own link targets through this
 * contract at all; it would have to fake them as `url` targets, defeating the point of a typed
 * target. `AdminMenuTarget` therefore keeps the 4 reference-implementation kinds as their own typed
 * variants (they are reasonably generic CMS concepts, not literally "post"/"page") but adds
 * `AdminMenuCustomTarget` as a fifth, open-`kind` escape hatch for anything else a host needs.
 *
 * This has a real, deliberate type-safety cost worth knowing before you rely on it: because
 * `AdminMenuCustomTarget.kind` is `string & {}`, it structurally overlaps every literal kind below
 * it — narrowing `AdminMenuTarget` by `target.kind === "entryRef"` does not, on its own, fully
 * exclude `AdminMenuCustomTarget` from the narrowed type the way it would exclude
 * `AdminMenuTermTarget`/`AdminMenuUrlTarget`/`AdminMenuRouteTarget`. In practice this only shows up
 * as a compile error if you then try to access a known-target-only field (e.g. `.entryId`) without
 * having ruled out the custom-target case first, since `AdminMenuCustomTarget` carries no such
 * field — TypeScript will refuse the access rather than silently mistype it. A `switch` over all 5
 * `kind` values (with `AdminMenuCustomTarget` as the `default` arm) is the straightforward way to
 * stay correct.
 *
 * **This is a deliberately deferred decision, not a settled one — record it as such.** `entryRef`/
 * `termRef` encode a host content model (an "entry" and a "taxonomy term" are the reference
 * implementation's own vocabulary for its content system, not a vendor-neutral abstraction this
 * package has designed). A host with no entries or taxonomies should emit only `url`/`route`
 * targets and ignore those two variants entirely; it is not expected to reinterpret them. This was
 * deliberately NOT generalized into a single vendor-neutral "content reference" shape, because
 * there is exactly one host implementation in this corpus today — designing a generic content-reference abstraction from a single
 * example is how a package acquires the wrong abstraction permanently, not how it becomes generic.
 * Widening `kind` (this file) costs nothing and preserves the option without committing to a shape.
 * **Trigger for revisiting:** a second host needs a link-target kind that is neither `entryRef`,
 * `termRef`, `url`, nor `route` — at that point there are two real examples to generalize from
 * instead of one, and a genuine vendor-neutral reference shape (rather than another bespoke
 * `kind`-per-host member) becomes the right call.
 *
 * ## `deleteMenu` is a two-rung ladder driven by call count, not by `force` alone
 *
 * A single method models a two-step deletion flow: the FIRST call against a non-trashed menu
 * always soft-deletes it (status flips, resolves `{ purged: false }`) regardless of `force` or
 * location bindings. Only a SECOND call — against a menu that is already trashed — attempts the
 * real purge, which is rejected (conflict-class, with the still-bound location keys) if the menu is
 * still assigned to any theme location, unless `options.force` is set. This is a third distinct
 * deletion shape in this port set, different from both `AdminIntegrationsPort`'s permanent-soft-
 * delete-only and `AdminMediaPort`'s two-separate-methods (`trashMedia`/`deleteMedia`) split: here
 * it is the SAME method, and which rung it hits depends on the menu's current state, not on an
 * argument you pass. A panel must track (or re-fetch) whether a menu is already trashed to know
 * what calling `deleteMenu` again will actually do.
 *
 * ## `assignMenuLocation` can displace another menu (last-writer-wins)
 *
 * Assigning a menu to a location key that is already bound to a *different* menu unassigns that
 * other menu from the location (dropping the key from its own `locations`) rather than rejecting
 * the call. `AdminAssignMenuLocationResult.displacedMenu` carries that menu's post-displacement
 * state so a panel can show what changed; it is `null` when the location was unbound or already
 * held by the menu being assigned.
 *
 * ## Open vs. closed unions
 *
 * `NavTargetKind` and `MenuStatus` are reference-implementation-specific vocabularies (the former further discussed
 * above) — OPEN, via the `T | (string & {})` idiom `seo.ts`'s file header introduces for this port
 * set.
 */

/** The known target-kind discriminants — open, see file header. */
export type NavTargetKind = "entryRef" | "termRef" | "url" | "route" | (string & {});

/** A link to another content item, by opaque id. */
export interface AdminMenuEntryTarget {
  readonly kind: "entryRef";
  readonly entryId: string;
}

/** A link to a taxonomy term (category/tag archive, or a host's closest equivalent grouping). */
export interface AdminMenuTermTarget {
  readonly kind: "termRef";
  readonly termId: string;
  /** Which taxonomy `termId` belongs to. */
  readonly taxonomy: string;
}

/** An absolute or site-relative external URL. */
export interface AdminMenuUrlTarget {
  readonly kind: "url";
  readonly href: string;
}

/** A named host route (e.g. `home`, `search`). */
export interface AdminMenuRouteTarget {
  readonly kind: "route";
  readonly route: string;
  readonly params?: Record<string, unknown>;
}

/** A host-specific target kind beyond the 4 above — see file header for the narrowing tradeoff
 *  this member introduces. `data` is opaque to this port; the host defines its own shape. */
export interface AdminMenuCustomTarget {
  readonly kind: string & {};
  readonly data?: Record<string, unknown>;
}

export type AdminMenuTarget =
  | AdminMenuEntryTarget
  | AdminMenuTermTarget
  | AdminMenuUrlTarget
  | AdminMenuRouteTarget
  | AdminMenuCustomTarget;

export interface AdminMenuItemAttrs {
  readonly openInNewTab?: boolean;
  /** `rel` tokens (e.g. `nofollow`). */
  readonly rel?: string;
  readonly cssClass?: string;
  readonly description?: string;
  readonly icon?: string;
}

/** One node in a menu's item tree. Ordering is array order among siblings; nesting is `children`.
 *  `id` must be stable across edits (see `updateMenuTree`) — never regenerate it on reorder. */
export interface AdminMenuItem {
  readonly id: string;
  /** As stored — this port does not fall back to the target's own title when absent. (The
   *  reference implementation only applies that fallback in its separate, unexposed render-time
   *  resolution model; the raw item this port returns leaves an absent label absent.) A panel
   *  wanting a display fallback must compute one itself. */
  readonly label?: string;
  readonly target: AdminMenuTarget;
  readonly attrs?: AdminMenuItemAttrs;
  readonly children?: readonly AdminMenuItem[];
}

/** Lifecycle of a menu itself — open, see file header. */
export type MenuStatus = "draft" | "published" | "trash" | (string & {});

export interface AdminMenu {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: MenuStatus;
  readonly items: readonly AdminMenuItem[];
  /** Theme-location keys this menu currently fills. */
  readonly locations: readonly string[];
  readonly updatedAt: string;
  readonly version: number;
}

export interface AdminMenuCreateInput {
  readonly title: string;
  readonly slug: string;
  /** Defaults to an empty menu when omitted. Every item needs a stable `id`. */
  readonly items?: readonly AdminMenuItem[];
}

export interface AdminMenuUpdateTreeInput {
  /** The `version` this edit was based on — optimistic-concurrency guard; expect a conflict-class
   *  rejection if the menu was modified since. */
  readonly expectedVersion: number;
  readonly title?: string;
  readonly slug?: string;
  /** The FULL replacement tree — this is a whole-tree replace, not a per-item patch. */
  readonly items: readonly AdminMenuItem[];
}

export interface AdminMenuBinding {
  readonly locationKey: string;
  readonly menuId: string;
  readonly boundAt: string;
}

export interface AdminAssignMenuLocationResult {
  readonly menu: AdminMenu;
  readonly binding: AdminMenuBinding;
  /** See file header (last-writer-wins displacement). */
  readonly displacedMenu: AdminMenu | null;
}

export interface AdminDeleteMenuResult {
  /** Null only after a successful purge (the second-rung outcome) — see file header. */
  readonly menu: AdminMenu | null;
  readonly purged: boolean;
}

export interface AdminMenusPort {
  listMenus(): Promise<readonly AdminMenu[]>;
  getMenu(id: string): Promise<AdminMenu>;
  createMenu(input: AdminMenuCreateInput): Promise<AdminMenu>;
  updateMenuTree(id: string, input: AdminMenuUpdateTreeInput): Promise<AdminMenu>;
  /** Two-rung ladder driven by the menu's current trashed state, not solely by `options.force` —
   *  see file header before assuming what a given call will do. */
  deleteMenu(id: string, options?: { force?: boolean }): Promise<AdminDeleteMenuResult>;
  /** May displace another menu already bound to `locationKey` — see file header. */
  assignMenuLocation(id: string, locationKey: string): Promise<AdminAssignMenuLocationResult>;
}
