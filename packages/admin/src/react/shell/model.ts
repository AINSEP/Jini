import { buildNav, resolveAgentPageId, resolvePanels, type AdminNavGroup } from '../../core/manifest/rules.js';
import { matchRoute } from '../../core/routing/rules.js';
import type { AdminRoute } from '../../core/routing/types.js';
import type { AdminShellPanel, AdminShellSession } from './types.js';

export interface AdminShellModel {
  readonly panels: readonly AdminShellPanel[];
  readonly panel: AdminShellPanel | undefined;
  /** Always names a panel: an unmatched or root path resolves to the host's default panel. */
  readonly route: AdminRoute & { readonly panelId: string };
  readonly nav: readonly AdminNavGroup[];
  readonly agentPageId: string | null;
}

/**
 * Derive navigation and render dispatch from one resolved manifest.
 * @param args Required host manifest, session, route and fallback panel.
 * @param options Optional wired capability keys.
 * @returns A matched route or a clean default index route. Never mutates contributions.
 */
export function resolveAdminShellModel(
  args: { readonly panels: readonly AdminShellPanel[]; readonly session: AdminShellSession; readonly routePath: string; readonly defaultPanelId: string },
  options: { readonly capabilities?: readonly string[] } = {},
): AdminShellModel {
  const panels = resolvePanels({ panels: args.panels }, {
    capabilities: options.capabilities ?? [],
    permissions: args.session.effectivePermissions ?? [],
  });
  const matched = matchRoute({ routePath: args.routePath, panels });
  // `split` with a string separator always returns at least one element, so index 0 exists.
  const rawPath = args.routePath.split('?')[0]!;
  const isRoot = rawPath.split('/').filter(Boolean).length === 0;
  // The existing matcher maps root to dashboard. The shell's default is host-owned.
  const route: AdminShellModel['route'] = isRoot || matched.panelId === null
    ? { panelId: args.defaultPanelId, view: null, params: {}, query: matched.query }
    : { ...matched, panelId: matched.panelId };
  return {
    panels,
    panel: panels.find((panel) => panel.id === route.panelId),
    route,
    nav: buildNav({ panels }, { defaultPanelId: args.defaultPanelId }),
    agentPageId: resolveAgentPageId({ panels, panelId: route.panelId, view: route.view }),
  };
}
