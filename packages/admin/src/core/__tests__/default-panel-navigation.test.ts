import { expect, it } from 'vitest';
import { buildAgentPageMap, buildNav, panelHref } from '../manifest/rules.js';
import { resolveAdminShellModel } from '../../react/shell/model.js';

const panels = [
  { id: 'home', render: () => null, nav: { label: 'Home' }, agentReachable: true },
  { id: 'dashboard', render: () => null, nav: { label: 'Dashboard' }, agentReachable: true },
];
const session = { user: { id: 'u1', username: 'operator' } };

it('dashboard nav and agent destinations resolve to dashboard when home owns root', () => {
  const model = resolveAdminShellModel({ panels, session, routePath: '/', defaultPanelId: 'home' });
  expect(model.route.panelId).toBe('home');
  const href = model.nav.flatMap((group) => group.items).find((item) => item.id === 'dashboard')!.href;
  expect(href).toBe('/dashboard');
  const map = buildAgentPageMap({ panels }, { defaultPanelId: 'home' });
  expect(map).toEqual({ home: '/home', dashboard: '/dashboard' });
  for (const routePath of [href, map.dashboard!]) {
    const destination = resolveAdminShellModel({ panels, session, routePath, defaultPanelId: 'home' });
    expect(destination.route.panelId).toBe('dashboard');
    expect(destination.agentPageId).toBe('dashboard');
  }
});

it('keeps the conventional dashboard root when the host supplies no override', () => {
  expect(panelHref({ panelId: 'dashboard' })).toBe('/');
  expect(buildNav({ panels }).flatMap((group) => group.items).find((item) => item.id === 'dashboard')!.href).toBe('/');
  expect(buildAgentPageMap({ panels })).toEqual({ home: '/home', dashboard: '/' });
});
