import { buildNav, resolveAgentPageId, resolvePanels, type AdminNavGroup } from '../../core/manifest/rules.js';
import { isPanelAccessible } from '../../core/permissions/rules.js';
import { matchRoute } from '../../core/routing/rules.js';
import type { AdminRoute } from '../../core/routing/types.js';
import type { AdminShellPanel, AdminShellSession } from './types.js';

export interface AdminShellModel {
  /** The panels this operator can use (visible set): what the nav is built from. */
  readonly panels: readonly AdminShellPanel[];
  /** The routed panel, looked up among every capability-wired panel, so a denied one is still found. */
  readonly panel: AdminShellPanel | undefined;
  /** Always names a panel: an unmatched or root path resolves to the host's default panel. */
  readonly route: AdminRoute & { readonly panelId: string };
  readonly nav: readonly AdminNavGroup[];
  readonly agentPageId: string | null;
  /**
   * `'denied'` when the routed panel's permission declarations are not met: the shell then renders the
   * host's `noAccess` slot instead of the panel. Client-side visibility only; the server stays the
   * authority. `'allowed'` when no panel resolves for the route (nothing declared, nothing to deny).
   */
  readonly access: 'allowed' | 'denied';
}

/**
 * Route recognition is capability-gated only, so it passes the owner wildcard on purpose.
 * `resolvePanels` turns a missing `permissions` into `[]` and then drops every panel that declares
 * all-of `permissions` (`core/manifest/rules.ts:34,38`): with no argument, every all-of panel would be
 * unroutable for every user, held or not. The operator's real permissions are applied afterwards by
 * `isPanelAccessible` (visible set and `access`), never by route recognition: passing them here would
 * turn a denied all-of URL back into a silent fall-back to the default panel.
 */
const ROUTE_RECOGNITION = { permissions: ['*'] } as const;

/** Match the path, falling back to the host's default panel for root and for an unmatched path. */
function resolveShellRoute(
  { panels, routePath, defaultPanelId }: { readonly panels: readonly AdminShellPanel[]; readonly routePath: string; readonly defaultPanelId: string },
): AdminShellModel['route'] {
  const matched = matchRoute({ routePath, panels });
  // `split` with a string separator always returns at least one element, so index 0 exists.
  const rawPath = routePath.split('?')[0]!;
  const isRoot = rawPath.split('/').filter(Boolean).length === 0;
  // The existing matcher maps root to dashboard. The shell's default is host-owned.
  return isRoot || matched.panelId === null
    ? { panelId: defaultPanelId, view: null, params: {}, query: matched.query }
    : { ...matched, panelId: matched.panelId };
}

/**
 * Derive navigation and render dispatch from one resolved manifest.
 * @param args Required host manifest, session, route and fallback panel.
 * @param options Optional wired capability keys.
 * @returns A matched route or a clean default index route, with `access` for the routed panel. Never mutates contributions.
 */
export function resolveAdminShellModel(
  args: { readonly panels: readonly AdminShellPanel[]; readonly session: AdminShellSession; readonly routePath: string; readonly defaultPanelId: string },
  options: { readonly capabilities?: readonly string[] } = {},
): AdminShellModel {
  const routable = resolvePanels({ panels: args.panels }, { capabilities: options.capabilities ?? [], ...ROUTE_RECOGNITION });
  // `undefined` (permissions not known yet) is passed through as is: it must never collapse to `[]`.
  const permissions = args.session.effectivePermissions;
  const panels = routable.filter((panel) => isPanelAccessible({ panel, permissions }));
  const route = resolveShellRoute({ panels: routable, routePath: args.routePath, defaultPanelId: args.defaultPanelId });
  const panel = routable.find((candidate) => candidate.id === route.panelId);
  return {
    panels,
    panel,
    route,
    nav: buildNav({ panels }, { defaultPanelId: args.defaultPanelId }),
    agentPageId: resolveAgentPageId({ panels: routable, panelId: route.panelId, view: route.view }),
    access: panel !== undefined && !isPanelAccessible({ panel, permissions }) ? 'denied' : 'allowed',
  };
}
