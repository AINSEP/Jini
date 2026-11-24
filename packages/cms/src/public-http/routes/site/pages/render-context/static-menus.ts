// Keep request rendering separate from theme installation, imports, and agent tools.
// This `public-http` entry reaches the `navigation` and `routing` domains only through the type-only
// imports below: their functions arrive as the injected {@link StaticMenuCollaborators} (the host
// binds `findBoundMenu`/`resolveMenuDoc` from `@jini-ai/cms/navigation` and its `urlFor`), so the
// subpath stays isolated from those domains' runtime code. Which marker ids a theme references, and
// any reserved marker ids a host's themes author, are the host's: it passes the ids in and the
// reserved resolvers through {@link StaticMenuReservedResolver}.
import type { UUID } from "@jini-ai/core/primitives";
import type { findBoundMenu, resolveMenuDoc } from "../../../../../navigation/index.js";
import type { MenuRepoPort, NavLocationBindingRepoPort, NavMenuEntry, NavTarget, ResolvedNavItem, ResolveTargetHrefFn } from "../../../../../navigation/index.js";
import type { RouteTarget } from "../../../../../routing/index.js";

/** The route resolver the host binds (its `urlFor` with the request's repos and workspace closed
 *  over): a route target's public path, or `null` when it does not resolve. */
export type StaticMenuUrlFor = (required: { target: RouteTarget }) => Promise<{ path: string } | null>;

/** The other CMS domains' functions static-menu resolution calls, injected rather than imported. */
export interface StaticMenuCollaborators {
  readonly navigation: {
    readonly findBoundMenu: typeof findBoundMenu;
    readonly resolveMenuDoc: typeof resolveMenuDoc;
  };
  readonly urlFor: StaticMenuUrlFor;
}

/** The repos and workspace a static-menu lookup reads. */
export interface StaticMenuRepoDeps {
  readonly workspaceId: UUID;
  readonly menuRepo: MenuRepoPort;
  readonly navLocationBindingRepo: NavLocationBindingRepoPort;
}

/** An HTML-mode menu: the author's own stored markup, placed as-is at the marker. */
export interface StaticMenuHtml {
  readonly html: string;
}

/** What one menu id resolved to: its item tree, or its authored HTML. */
export type StaticMenuContent = readonly ResolvedNavItem[] | StaticMenuHtml;

/** `NavTarget` (`navigation`) and `RouteTarget` (`routing`) are two independently-declared
 * discriminated unions with the same four kinds and matching fields (see `@jini-ai/cms/routing`'s file
 * header: the vocabulary was "promoted from Menus-local to routing-owned" precisely so both domains
 * share it) — but they remain two separate type declarations, not one shared import, so this maps
 * explicitly per-kind rather than relying on structural assignability compiling by coincidence.
 */
function navTargetToRouteTarget(target: NavTarget): RouteTarget {
  switch (target.kind) {
    case "entryRef":
      return { kind: "entryRef", entryId: target.entryId };
    case "termRef":
      return { kind: "termRef", termId: target.termId, taxonomy: target.taxonomy };
    case "url":
      return { kind: "url", href: target.href };
    case "route":
      return target.params === undefined ? { kind: "route", route: target.route } : { kind: "route", route: target.route, params: target.params };
    // Preserve the undefined fallback for runtime inputs outside this exhaustive union.
    default: return undefined as never;
  }
}

/** What every static-menu marker resolution needs: deps, the request's path context, the
 *  shared target-href resolver, and the injected collaborators. */
export interface StaticMenuResolution {
  readonly deps: StaticMenuRepoDeps;
  readonly context: { workspaceId: string; currentPath: string };
  readonly resolveTargetHref: ResolveTargetHrefFn;
  readonly collaborators: StaticMenuCollaborators;
}

export type StaticMenuEntry = readonly [string, StaticMenuContent];

/** A host's resolver for one reserved marker id (one that names no single stored menu); `undefined`
 *  leaves the theme's authored fallback content in place. */
export type StaticMenuReservedResolver = (required: { menuId: string; env: StaticMenuResolution }, optional?: Record<string, never>) => Promise<StaticMenuEntry | undefined>;

/**
 * One stored menu's render content: its author-written HTML when the menu is in HTML mode (owner
 * 2026-10-08, Jini `menu-html.ts`), else its resolved item tree.
 */
export async function resolveMenuContent({ menu, env }: { menu: NavMenuEntry; env: StaticMenuResolution }, _optional = {}): Promise<StaticMenuContent> {
  if (menu.doc.mode === "html") return { html: menu.doc.html ?? "" };
  return env.collaborators.navigation.resolveMenuDoc({ doc: menu.doc, context: env.context, resolveTargetHref: env.resolveTargetHref });
}

/** Binding selection belongs to Jini; the static marker contract retains slug/id compatibility.
 * @returns A stored menu or null. Repository faults propagate.
 * @complexity At most four indexed reads per theme-authored marker, O(1) additional space.
 */
// After the binding, SLUG first, id second. A theme marker is authored once and shipped to every
// install, but `createMenu` mints a menu's id with `idGen.newId()` — so a hardcoded `data-embed-id`
// could only ever match on the one install where that random id happened to be generated. The slug
// is the stable machine handle the model already documents for exactly this ("e.g. `primary-nav`",
// navigation/types.ts:161), so it is what a shipped theme can actually name. The id lookup stays as
// the fallback for a marker pointing at a specific stored menu, which is what the pre-2026-08-10
// behavior did unconditionally.
// The id fallback is also required for `HEADER_NAV_MENU_SLUG` ("menu-header-nav"): it is the literal
// `data-embed-id` nav.html's theme author wrote, but the seeded `menu-header-nav` row's real `slug`
// column is `"header-nav"` (no `menu-` prefix) — only its primary-key `id` column equals the literal.
// A slug-only lookup therefore always missed on real data, degrading `docs-section`/`docs-prev-next`
// to their authored fallback on every page (found 2026-09-24 debugging a live "No docs menu bound
// yet" sidebar against production data, not caught by the unit tests' own fixture menu, which
// happened to give its slug and id the same value).
export async function findStaticMenu(
  { menuId, env }: { menuId: string; env: StaticMenuResolution },
  _optional: Record<string, never> = {},
): Promise<NavMenuEntry | null> {
  const { deps, collaborators } = env;
  return (await collaborators.navigation.findBoundMenu({
    deps: { menuRepo: deps.menuRepo, bindingRepo: deps.navLocationBindingRepo },
    input: { workspaceId: deps.workspaceId, locationKey: menuId },
  })) ?? (await deps.menuRepo.findBySlug({ workspaceId: deps.workspaceId, slug: menuId }))
    ?? deps.menuRepo.findById({ workspaceId: deps.workspaceId, id: menuId });
}

/** One menu marker id to its `[id, content]` entry, or `undefined` for a miss (the theme's authored
 *  fallback content stays). @complexity Up to four indexed menu/binding reads plus the doc walk. */
async function resolveOneStaticMenu({ menuId, env, reserved }: { menuId: string; env: StaticMenuResolution; reserved: ReadonlyMap<string, StaticMenuReservedResolver> }, _optional: Record<string, never> = {}): Promise<StaticMenuEntry | undefined> {
  const reservedResolver = reserved.get(menuId);
  if (reservedResolver) return reservedResolver({ menuId, env });
  const menu = await findStaticMenu({ menuId, env });
  if (!menu) return undefined;
  return [menuId, await resolveMenuContent({ menu, env })] as const;
}

/**
 * Direct menu-embed wiring (2026-08-10) — resolves every `data-embed-type="menu"` marker a
 * `static`-tier active theme's own pages/partials reference (`scanMenuEmbedIds`) into render-ready
 * link data, ahead of `renderSite`/`renderStaticPage`. Mirrors `resolveWidgetsForRender`'s own
 * "route resolves, render stays I/O-free" split (this is the one call site for this resolution).
 *
 * Selection (2026-10-25, ADR-029 §7): a marker id is FIRST a location key — a menu assigned to that
 * location through `nav_location_bindings` (Jini's `findBoundMenu`, the same lookup
 * `resolveForLocation` uses) wins over a stored menu whose slug or id happens to match. With no
 * (or a stale) binding, the marker falls back to slug, then id (see `findStaticMenu`). The August 10
 * decision that bypassed bindings for static themes is superseded; its rationale is kept in
 * ./NOTES.md. `resolveMenuDoc` (`navigation`) is the doc-level building block
 * `resolveForLocation` itself composes on top of a location lookup — called directly here per
 * referenced menu id. It still needs the same injected `resolveTargetHref` seam `routing`'s
 * own `urlFor` backs, for exactly the same reason `resolveForLocation` needed it.
 *
 * Non-static themes never call this (checked by the caller); declarative/templated/handlebars themes
 * have their own, separate `menu` WIDGET type (`Jini/packages/cms/src/widgets/resolvers/menu.ts`, `resolveMenuDoc` over an
 * explicit per-instance `menuRef`) that already renders real menu content today — a different,
 * narrower mechanism (one specific menu placed by an author, not a theme marker naming a shared
 * site-wide menu), left untouched by this change.
 *
 * A referenced id absent from the returned map (no such menu, wrong workspace, or a theme-authoring
 * typo) is `renderStaticPage`'s own `injectMenuEmbed` treating "no entry" as "leave the theme's
 * authored fallback content untouched" — no caller-side branching needed for that case either.
 *
 * @complexity Up to one binding read plus two menu reads, then `resolveMenuDoc`, per distinct menu
 * id the theme's markup references (bounded in practice to the small, fixed set an author wrote
 * into the theme's own files), run concurrently.
 */
export async function resolveStaticMenusForIds(
  { deps, menuIds, currentPath, collaborators }: { deps: StaticMenuRepoDeps; menuIds: readonly string[]; currentPath: string; collaborators: StaticMenuCollaborators },
  { reserved = new Map() }: { reserved?: ReadonlyMap<string, StaticMenuReservedResolver> } = {},
): Promise<Readonly<Record<string, StaticMenuContent>>> {
  if (menuIds.length === 0) return {};

  const resolveTargetHref: ResolveTargetHrefFn = async ({ target }) => {
    const resolved = await collaborators.urlFor({ target: navTargetToRouteTarget(target) });
    return resolved ? { path: resolved.path, available: true } : null;
  };

  const env: StaticMenuResolution = { deps, context: { workspaceId: deps.workspaceId, currentPath }, resolveTargetHref, collaborators };
  const entries = await Promise.all(menuIds.map((menuId) => resolveOneStaticMenu({ menuId, env, reserved })));

  return Object.fromEntries(
    entries.filter((entry): entry is StaticMenuEntry => entry !== undefined)
  );
}
