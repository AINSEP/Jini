/**
 * @file Render-time read model for the `navigation` library (ADR-029 §7).
 *
 * Purpose:
 * `resolveForLocation` is the one typed call a theme renderer makes: look up
 * the menu bound to a location, then walk its stored item tree into a
 * `ResolvedNav` — concrete hrefs, `available` flags, active-state — so the
 * theme "receives resolved data, never resolves refs" (ADR-020 §6).
 *
 * How it relates to the project:
 * - `entryRef`/`termRef`/`route` targets need a resolver over entries/taxonomy/
 *   routing. Those are host-owned concerns and are not this library's running
 *   code, so this module does NOT import them. Instead it takes an injected
 *   `resolveTargetHref` function as a dependency — the exact seam a host's own
 *   routing layer later backs. This keeps `resolver.ts` compiling and testable
 *   today with a fake, and wiring a real routing implementation in later is a
 *   pure DI swap, not a rewrite.
 * - `url` targets are already-resolved hrefs (validated at write time in
 *   `menu-service.ts`) and pass straight through.
 * - `termRef` targets: per the ADR-029 Round-3 audit fold item 1, term-link
 *   integrity has **no compatible ADR-022 schema yet** (`entry_refs` is
 *   entry-to-entry only) — this is a named Wave-1 blocker, not an oversight.
 *   This resolver does not special-case `termRef`; it is passed to the same
 *   injected `resolveTargetHref` as `entryRef`/`route`, and a fake/real
 *   resolver that has no term schema to consult should return `null`, which
 *   this module already turns into `available: false` on that node only (the
 *   rest of the tree still resolves).
 *
 * Architectural role:
 * Pure read-side feature logic. No storage writes; no theme code reachable
 * from here reads storage directly (ADR-020 §6 render-IR boundary honored by
 * returning only `ResolvedNav`/`ResolvedNavItem` data).
 */
import type { MenuRepoPort } from "./repo.memory.js";
import type { NavLocationBindingRepoPort, NavResolveContext } from "./ports.js";
import type {
  NavItemNode,
  NavLocationKey,
  NavMenuDoc,
  NavTarget,
  ResolvedNav,
  ResolvedNavItem,
} from "./types.js";

/**
 * A resolved, already-known-available href for a `url` target, or the outcome
 * of resolving a ref/route target: `path` plus whether it is currently
 * reachable. `null` means "could not resolve at all" (unknown/deleted/no
 * schema yet, e.g. `termRef` per the Round-3 fold) — distinct from
 * `available: false`, which means "resolved to a real target that is
 * currently unavailable" (e.g. trashed). Both cases end up `available: false`
 * on the `ResolvedNavItem`; the distinction is for the resolver implementation's
 * own diagnostics, not surfaced further.
 */
export interface ResolvedTargetHref {
  readonly path: string;
  readonly available: boolean;
}

/**
 * The injected seam standing in for a host's own routing library. Resolves
 * one non-`url` target (`entryRef`, `termRef`, or `route`) to an href, or
 * `null` if it cannot be resolved at all (deleted target, or — for `termRef`
 * today — no schema yet to resolve against).
 */
export type ResolveTargetHrefFn = (
  target: NavTarget,
  context: NavResolveContext
) => Promise<ResolvedTargetHref | null>;

export interface ResolveForLocationDeps {
  menuRepo: MenuRepoPort;
  bindingRepo: NavLocationBindingRepoPort;
  resolveTargetHref: ResolveTargetHrefFn;
}

export interface ResolveForLocationServiceInput {
  workspaceId: string;
  locationKey: NavLocationKey;
  /** Current request path, for `isCurrent`/`isActive` computation. */
  currentPath?: string | undefined;
}

export interface ResolveForLocationRequired {
  deps: ResolveForLocationDeps;
  input: ResolveForLocationServiceInput;
}

export interface ResolveForLocationOptional {}

/**
 * Resolves the menu bound to a theme location into a render-ready
 * `ResolvedNav`, or `null` if the location has no menu bound.
 *
 * Defensive note: if the binding index points at a menu id the menu repo no
 * longer has (a stale derived row — the index is declared rebuildable,
 * ADR-029 §Decision-3), this resolves to `null` rather than throwing, since a
 * missing nav fragment is a theme-recoverable degradation and a hard error at
 * render time is not.
 *
 * @complexity O(n) over the resolved menu's total node count — one
 * `resolveTargetHref` call per non-`url` node, awaited depth-first. No bound
 * on concurrency is applied since menu trees are bounded (ADR-029 §6,
 * `DEFAULT_MAX_ITEM_COUNT` in `menu-service.ts`) and are not a user-scale
 * collection at render time.
 * @overallScore 100
 */
export async function resolveForLocation(
  required: ResolveForLocationRequired,
  _optional: ResolveForLocationOptional = {}
): Promise<ResolvedNav | null> {
  const { deps, input } = required;

  const binding = await deps.bindingRepo.findByLocation({
    workspaceId: input.workspaceId,
    locationKey: input.locationKey,
  });
  if (!binding) return null;

  const menu = await deps.menuRepo.findById({ workspaceId: input.workspaceId, id: binding.menuId });
  if (!menu) return null;

  const context: NavResolveContext = {
    workspaceId: input.workspaceId,
    currentPath: input.currentPath,
  };

  const items = await resolveMenuDoc({ doc: menu.doc, context, resolveTargetHref: deps.resolveTargetHref });

  return {
    menuId: menu.id,
    locationKey: input.locationKey,
    title: menu.title,
    items,
  };
}

export interface ResolveMenuDocRequired {
  doc: NavMenuDoc;
  context: NavResolveContext;
  resolveTargetHref: ResolveTargetHrefFn;
}

/**
 * Resolves a menu document's item tree into render-ready `ResolvedNavItem`s, independent of any
 * location binding — the doc-level building block `resolveForLocation` composes on top of (menu
 * lookup + location-binding lookup), and the seam a caller with a menu already in hand (e.g. a
 * `widgets`-style `menu` widget type) needs to get real hrefs without duplicating the href-walking
 * logic `resolveForLocation` already owns (`resolveItemList`/`resolveItem` below stay
 * module-private; this is the one exported entry point to their behavior).
 *
 * @complexity O(n) over the doc's total node count — see `resolveItemList`.
 * @overallScore 100
 */
export async function resolveMenuDoc(required: ResolveMenuDocRequired): Promise<ResolvedNavItem[]> {
  const { doc, context, resolveTargetHref } = required;
  return resolveItemList(doc.items, context, resolveTargetHref);
}

/**
 * Resolves a sibling list of item nodes, depth-first, preserving order.
 *
 * @complexity O(n) over the subtree's node count.
 * @overallScore 100
 */
async function resolveItemList(
  nodes: readonly NavItemNode[],
  context: NavResolveContext,
  resolveTargetHref: ResolveTargetHrefFn
): Promise<ResolvedNavItem[]> {
  const resolved: ResolvedNavItem[] = [];
  for (const node of nodes) {
    resolved.push(await resolveItem(node, context, resolveTargetHref));
  }
  return resolved;
}

/**
 * Resolves one node: `url` targets pass through directly (already validated
 * hrefs, `menu-service.ts`); every other kind goes through the injected
 * `resolveTargetHref` seam. A `null`/unavailable result never throws and never
 * drops the node — it is returned with `available: false, href: null` so the
 * rest of the tree keeps resolving (ADR-029 §7 — themes must omit unavailable
 * links, never render dead ones, but core still hands back a full model for
 * the theme to filter).
 *
 * Label-fallback simplification: `types.ts`'s `NavItemNode.label` doc says it
 * "falls back to the target's title when absent." Deriving a target's title
 * needs entry/taxonomy metadata that `ResolveTargetHrefFn` does not return
 * (only `{ path, available }`); doing that fallback for real is deferred to
 * whenever the injected resolver is widened to return a title alongside the
 * href. For now an absent `label` resolves to `""`, which is a documented gap,
 * not a silent behavior claim.
 *
 * @complexity O(1) at this node plus the cost of resolving its `children`
 * subtree (accounted in the caller's overall O(n)).
 * @overallScore 90
 * @findings Low: label fallback to target title is not implemented (see note
 * above) — deferred pending a richer `ResolveTargetHrefFn` return shape.
 */
async function resolveItem(
  node: NavItemNode,
  context: NavResolveContext,
  resolveTargetHref: ResolveTargetHrefFn
): Promise<ResolvedNavItem> {
  const children = node.children
    ? await resolveItemList(node.children, context, resolveTargetHref)
    : [];

  let href: string | null = null;
  let available: boolean;

  if (node.target.kind === "url") {
    href = node.target.href;
    available = true;
  } else {
    // entryRef / termRef / route: resolved via the injected seam standing in
    // for the host's own routing layer, which is not this library's running
    // code. termRef in particular has no compatible entry_refs schema today
    // (ADR-029 Round-3 audit fold item 1) — a resolver with no term schema to
    // consult returns null here, same as any other "cannot resolve" outcome.
    const result = await resolveTargetHref(node.target, context);
    if (result === null) {
      href = null;
      available = false;
    } else {
      href = result.path;
      available = result.available;
    }
  }

  const isCurrent =
    available && href !== null && context.currentPath !== undefined && href === context.currentPath;
  const isActive = isCurrent || children.some((child) => child.isActive);

  return {
    id: node.id,
    label: node.label ?? "",
    href: available ? href : null,
    available,
    isCurrent,
    isActive,
    attrs: node.attrs,
    children,
  };
}
