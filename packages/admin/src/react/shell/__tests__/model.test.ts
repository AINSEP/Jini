import { describe, expect, it } from 'vitest';
import { resolveAdminShellModel } from '../model.js';
import type { AdminShellPanel } from '../types.js';

const panel = (id: string, extra: Partial<AdminShellPanel> = {}): AdminShellPanel => ({ id, description: `Manage ${id}.`, render: () => null, nav: { label: id }, ...extra });
const user = { id: 'u1', username: 'operator' };

describe('resolveAdminShellModel', () => {
  it('drops capability-gated panels when the host wires no capabilities, and permission-gated ones without grants', () => {
    const panels = [panel('home'), panel('media', { requires: ['media'] }), panel('users', { permissions: ['users.read'] })];
    const model = resolveAdminShellModel({ panels, session: { user, effectivePermissions: [] }, routePath: '/media', defaultPanelId: 'home' });
    expect(model.panels.map(p => p.id)).toEqual(['home']);
    expect(model.route).toMatchObject({ panelId: 'home', view: null });
    expect(model.panel?.id).toBe('home');
  });

  it('keeps a matched route and its query, and sends root to the host default panel', () => {
    const panels = [panel('home'), panel('posts', { routes: [{ pattern: '/:postId', view: 'editor' }] })];
    const matched = resolveAdminShellModel({ panels, session: { user, effectivePermissions: [] }, routePath: '/posts/p1?tab=seo', defaultPanelId: 'home' }, { capabilities: [] });
    expect(matched.route).toMatchObject({ panelId: 'posts', view: 'editor', params: { postId: 'p1' } });
    expect(matched.route.query.get('tab')).toBe('seo');
    const root = resolveAdminShellModel({ panels, session: { user }, routePath: '/?tab=x', defaultPanelId: 'home' });
    expect(root.route).toMatchObject({ panelId: 'home', view: null, params: {} });
    expect(root.route.query.get('tab')).toBe('x');
  });

  it('declared change 1 (J1): while permissions are unknown a panel declaring all-of permissions is listed', () => {
    const panels = [panel('home'), panel('users', { permissions: ['users.read'] })];
    const model = resolveAdminShellModel({ panels, session: { user }, routePath: '/', defaultPanelId: 'home' });
    expect(model.panels.map(p => p.id)).toEqual(['home', 'users']);
    expect(model.nav.flatMap(g => g.items.map(i => i.id))).toEqual(['home', 'users']);
  });

  it('keeps a denied route on its own panel and marks it denied; a held or unknown one is allowed', () => {
    const panels = [panel('home'), panel('users', { anyOfPermissions: ['users.read'] })];
    const base = { panels, routePath: '/users', defaultPanelId: 'home' };
    const denied = resolveAdminShellModel({ ...base, session: { user, effectivePermissions: [] } });
    expect(denied).toMatchObject({ access: 'denied', route: { panelId: 'users' }, agentPageId: 'users' });
    expect(denied.panel?.id).toBe('users');
    expect(denied.panels.map(p => p.id)).toEqual(['home']);
    expect(resolveAdminShellModel({ ...base, session: { user, effectivePermissions: ['users.read'] } }).access).toBe('allowed');
    expect(resolveAdminShellModel({ ...base, session: { user } }).access).toBe('allowed');
  });

  it('is allowed when no panel resolves for the route, and denied when the default panel itself is denied', () => {
    const none = resolveAdminShellModel({ panels: [], session: { user, effectivePermissions: [] }, routePath: '/', defaultPanelId: 'missing' });
    expect(none).toMatchObject({ access: 'allowed', panel: undefined });
    const gatedHome = [panel('home', { anyOfPermissions: ['home.read'] })];
    expect(resolveAdminShellModel({ panels: gatedHome, session: { user, effectivePermissions: [] }, routePath: '/', defaultPanelId: 'home' }).access).toBe('denied');
  });
});
