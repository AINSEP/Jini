import { describe, expect, it } from 'vitest';
import { resolveAdminShellModel } from '../model.js';
import type { AdminShellPanel } from '../types.js';

const panel = (id: string, extra: Partial<AdminShellPanel> = {}): AdminShellPanel => ({ id, render: () => null, nav: { label: id }, ...extra });
const user = { id: 'u1', username: 'operator' };

describe('resolveAdminShellModel', () => {
  it('drops capability-gated panels when the host wires no capabilities, and permission-gated ones without grants', () => {
    const panels = [panel('home'), panel('media', { requires: ['media'] }), panel('users', { permissions: ['users.read'] })];
    const model = resolveAdminShellModel({ panels, session: { user }, routePath: '/media', defaultPanelId: 'home' });
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
});
