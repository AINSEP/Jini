/**
 * @file Pure functions over a panel set: what mounts, what the sidebar shows, what an agent may
 * reach. No DOM, no React, no I/O — every function here is a total function of its arguments,
 * which is what makes the shell's behaviour testable without rendering anything.
 */

import { hasPermission } from '../permissions/rules.js';
import type { AdminNavEntry, AdminPanel } from './types.js';

/** What the host has actually wired, as seen by the registry. */
export interface AdminRegistryContext {
  /** Capability keys with a supplied port. Matched against each panel's `requires`. */
  readonly capabilities?: readonly string[];
  /** The operator's effective permissions, as returned by the host's auth endpoint. May contain
   *  the owner wildcard `"*"` — see `permissions/rules.ts`. */
  readonly permissions?: readonly string[];
}

/**
 * The panels that actually mount, in registration order.
 *
 * A panel is dropped when a capability it requires is not wired, or when the operator lacks one
 * of its permissions. Both are *silent* by design: an unmet requirement means the section does
 * not exist for this build or this operator, which is different from an error.
 *
 * @complexity O(p * (r + m)) — p panels, r requirements each, m permissions each. All three are
 * small, bounded by what a developer typed into a manifest.
 */
export function resolvePanels<T>(
  panels: readonly AdminPanel<T>[],
  context: AdminRegistryContext = {},
): readonly AdminPanel<T>[] {
  const capabilities = context.capabilities ?? [];
  const permissions = context.permissions ?? [];
  return panels.filter((panel) => {
    const capabilitiesMet = (panel.requires ?? []).every((key) => capabilities.includes(key));
    if (!capabilitiesMet) return false;
    return (panel.permissions ?? []).every((p) => hasPermission(permissions, p));
  });
}

/** A sidebar group, ready to render. */
export interface AdminNavGroup {
  /** Group heading; absent for the ungrouped top row. */
  readonly label?: string;
  readonly items: readonly AdminNavItem[];
}

/** A sidebar row. `href` is a **route path** (`/settings`), never a URL — the shell applies the
 *  base. Conflating the two is what produced the reference implementation's
 *  `/admin/#/section/settings` URLs. */
export interface AdminNavItem extends AdminNavEntry {
  readonly id: string;
  readonly href: string;
}

/**
 * Derives the sidebar from the resolved panel set.
 *
 * Ordering is deterministic and has to be: groups appear in the order their first member was
 * registered (with the ungrouped row always first), and items sort by `order` ascending with
 * registration order as a stable tiebreak. A nav that reshuffles between builds because two
 * panels share an `order` is a real bug — operators navigate by muscle memory.
 *
 * @complexity O(n log n) on the items within each group; O(n) otherwise.
 */
export function buildNav<T>(panels: readonly AdminPanel<T>[]): readonly AdminNavGroup[] {
  const groups = new Map<string, AdminNavItem[]>();
  const groupOrder: string[] = [];
  // Sentinel for "no group". A panel cannot collide with it: `group` is `string | undefined`, and
  // an explicit empty-string group would be a labelless heading, which is the same thing.
  const UNGROUPED = '';

  panels.forEach((panel) => {
    if (!panel.nav) return;
    const key = panel.nav.group ?? UNGROUPED;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)?.push({ ...panel.nav, id: panel.id, href: panelHref(panel.id) });
  });

  // Ungrouped first regardless of when it was registered — it is the top row, not a peer group.
  const ordered = [
    ...groupOrder.filter((k) => k === UNGROUPED),
    ...groupOrder.filter((k) => k !== UNGROUPED),
  ];

  return ordered.map((key) => ({
    ...(key === UNGROUPED ? {} : { label: key }),
    items: stableSortByOrder(groups.get(key) ?? []),
  }));
}

/** `Array.prototype.sort` is specified as stable, so equal `order` values keep registration
 *  order — the tiebreak `buildNav` documents. Missing `order` sorts last, not as 0. */
function stableSortByOrder(items: readonly AdminNavItem[]): readonly AdminNavItem[] {
  return [...items].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

/** Panel id -> its **route path**. `dashboard` is the root, not `/dashboard`. */
export function panelHref(panelId: string): string {
  return panelId === 'dashboard' ? '/' : `/${panelId}`;
}

/**
 * The agent-navigable page ids: panel id -> route path.
 *
 * Derived from `agentReachable`, which is left unset on most panels and falls back to
 * `options.defaultReachable` (itself defaulting to `false`) — so with no options this is an
 * allowlist populated only by deliberate opt-in, exactly as the reference implementation's
 * hand-maintained page-map module was. An explicit `agentReachable: false` on a panel always
 * excludes it regardless of `defaultReachable`, so a host that flips the default can still opt a
 * specific panel back out. Detail routes are never gated by either — see `AdminPanel.agentReachable`.
 *
 * `defaultReachable: true` is for a host that has decided navigation-only reachability (getting an
 * agent TO a page) carries no meaningful risk on its own — actually operating a page's controls is
 * a separate, still per-element opt-in (`data-agent-element`) that this default has no effect on.
 * A host for which that isn't true (a panel an agent should never even be told exists) should keep
 * the default false and opt in per panel instead.
 *
 * Note the ordering dependency: callers must pass the **resolved** panel set, not the raw one, or
 * an agent could navigate to a panel whose capability is not wired.
 */
export function buildAgentPageMap<T>(
  panels: readonly AdminPanel<T>[],
  options: { readonly defaultReachable?: boolean } = {},
): Readonly<Record<string, string>> {
  const defaultReachable = options.defaultReachable ?? false;
  const map: Record<string, string> = {};
  panels.forEach((panel) => {
    if ((panel.agentReachable ?? defaultReachable) === true) map[panel.id] = panelHref(panel.id);

    // A param-free detail route carrying an `agentPageId` is a destination in its own right —
    // the reference implementation publishes `widget-regions -> /widgets/regions` exactly this
    // way. A route WITH params
    // is skipped: an agent has no id to supply, so publishing it would hand out a path that
    // cannot be navigated. See `AdminRoutePattern.agentPageId`.
    (panel.routes ?? []).forEach((route) => {
      if (!route.agentPageId) return;
      if (route.pattern.includes(':')) return;
      map[route.agentPageId] = `${panelHref(panel.id)}${route.pattern}`.replace('//', '/');
    });
  });
  return map;
}

/**
 * The page id a resolved route reports through `data-agent-page`.
 *
 * Deliberately NOT the same question as "which nav row lights up" — that is the panel id, and
 * conflating the two is the documented bug `AdminRoutePattern.agentPageId` exists to prevent.
 *
 * Falls back to the panel id so a detail route reports its list page (`/posts/abc` -> `posts`),
 * which is the nearest id an agent can actually act on.
 */
export function resolveAgentPageId<T>(
  panels: readonly AdminPanel<T>[],
  panelId: string | null,
  view: string | null,
): string | null {
  if (panelId == null) return null;
  const panel = panels.find((p) => p.id === panelId);
  if (!panel) return null;
  const matched = (panel.routes ?? []).find((r) => r.view === view);
  return matched?.agentPageId ?? panel.id;
}
