import { describe, expect, it } from 'vitest';
import {
  buildAgentPageMap,
  buildNav,
  panelHref,
  resolveAgentPageId,
  resolvePanels,
} from '../manifest/rules.js';
import type { AdminPanel } from '../manifest/types.js';

const p = (id: string, extra: Partial<AdminPanel<null>> = {}): AdminPanel<null> => ({
  id,
  render: null,
  ...extra,
});

describe('resolvePanels', () => {
  it('keeps a panel with no requirements', () => {
    expect(resolvePanels([p('users')]).map((x) => x.id)).toEqual(['users']);
  });

  it('drops a panel whose required capability is not wired', () => {
    const panels = [p('users'), p('payments', { requires: ['payments'] })];
    expect(resolvePanels(panels, { capabilities: [] }).map((x) => x.id)).toEqual(['users']);
  });

  it('keeps a panel once its capability is wired', () => {
    const panels = [p('payments', { requires: ['payments'] })];
    expect(resolvePanels(panels, { capabilities: ['payments'] }).map((x) => x.id)).toEqual(['payments']);
  });

  it('requires every capability, not just one', () => {
    const panels = [p('deploy', { requires: ['deploy', 'github'] })];
    expect(resolvePanels(panels, { capabilities: ['deploy'] })).toHaveLength(0);
    expect(resolvePanels(panels, { capabilities: ['deploy', 'github'] })).toHaveLength(1);
  });

  it('drops a panel the operator lacks permission for', () => {
    const panels = [p('users', { permissions: ['users.read'] })];
    expect(resolvePanels(panels, { permissions: [] })).toHaveLength(0);
    expect(resolvePanels(panels, { permissions: ['users.read'] })).toHaveLength(1);
  });

  it('lets the owner wildcard satisfy any permission', () => {
    const panels = [p('users', { permissions: ['users.read', 'users.write'] })];
    expect(resolvePanels(panels, { permissions: ['*'] })).toHaveLength(1);
  });

  it('preserves registration order', () => {
    const panels = [p('c'), p('a'), p('b')];
    expect(resolvePanels(panels).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('buildNav', () => {
  it('omits a panel with no nav entry, without dropping it from routing', () => {
    // `settings-raw` in Tovu is exactly this: reachable by URL, deliberately not in the sidebar.
    const panels = [p('dashboard', { nav: { label: 'Overview' } }), p('settings-raw')];
    const nav = buildNav(panels);
    expect(nav.flatMap((g) => g.items).map((i) => i.id)).toEqual(['dashboard']);
  });

  it('puts the ungrouped row first even when registered last', () => {
    const panels = [
      p('users', { nav: { label: 'Users', group: 'People' } }),
      p('dashboard', { nav: { label: 'Overview' } }),
    ];
    const nav = buildNav(panels);
    expect(nav[0]?.label).toBeUndefined();
    expect(nav[0]?.items.map((i) => i.id)).toEqual(['dashboard']);
    expect(nav[1]?.label).toBe('People');
  });

  it('sorts within a group by order ascending', () => {
    const panels = [
      p('b', { nav: { label: 'B', group: 'G', order: 2 } }),
      p('a', { nav: { label: 'A', group: 'G', order: 1 } }),
    ];
    expect(buildNav(panels)[0]?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps registration order as a stable tiebreak for equal order values', () => {
    const panels = [
      p('first', { nav: { label: 'First', group: 'G', order: 1 } }),
      p('second', { nav: { label: 'Second', group: 'G', order: 1 } }),
    ];
    expect(buildNav(panels)[0]?.items.map((i) => i.id)).toEqual(['first', 'second']);
  });

  it('sorts a missing order last rather than treating it as zero', () => {
    const panels = [
      p('unordered', { nav: { label: 'U', group: 'G' } }),
      p('ordered', { nav: { label: 'O', group: 'G', order: 5 } }),
    ];
    expect(buildNav(panels)[0]?.items.map((i) => i.id)).toEqual(['ordered', 'unordered']);
  });

  it('emits route paths, not URLs', () => {
    const panels = [p('settings', { nav: { label: 'Settings' } })];
    expect(buildNav(panels)[0]?.items[0]?.href).toBe('/settings');
  });
});

describe('panelHref', () => {
  it('maps the dashboard to the root', () => {
    expect(panelHref('dashboard')).toBe('/');
  });

  it('maps any other panel to its own segment', () => {
    expect(panelHref('settings')).toBe('/settings');
  });
});

describe('buildAgentPageMap', () => {
  it('excludes a panel that never opted in — the allowlist default', () => {
    expect(buildAgentPageMap([p('secrets')])).toEqual({});
  });

  it('excludes an explicit false', () => {
    expect(buildAgentPageMap([p('secrets', { agentReachable: false })])).toEqual({});
  });

  it('includes only explicit opt-ins', () => {
    const panels = [p('users', { agentReachable: true }), p('secrets')];
    expect(buildAgentPageMap(panels)).toEqual({ users: '/users' });
  });

  it('maps an agent-reachable dashboard to the root path', () => {
    expect(buildAgentPageMap([p('dashboard', { agentReachable: true })])).toEqual({ dashboard: '/' });
  });

  it('cannot be satisfied by nav presence alone — nav and agent reach are independent', () => {
    const panels = [p('users', { nav: { label: 'Users' } })];
    expect(buildAgentPageMap(panels)).toEqual({});
  });

  it('publishes a param-free detail route as its own destination', () => {
    // Tovu's real case: `widget-regions -> /widgets/regions`.
    const panels = [
      p('widgets', {
        agentReachable: true,
        routes: [
          { pattern: '/regions', view: 'widget-regions', agentPageId: 'widget-regions' },
          { pattern: '/regions/:regionKey', view: 'region-editor', agentPageId: 'widget-regions' },
        ],
      }),
    ];
    expect(buildAgentPageMap(panels)).toEqual({
      widgets: '/widgets',
      'widget-regions': '/widgets/regions',
    });
  });

  it('never publishes a parameterized route — an agent has no id to supply', () => {
    const panels = [
      p('posts', { routes: [{ pattern: '/:postId', view: 'editor', agentPageId: 'post-editor' }] }),
    ];
    expect(buildAgentPageMap(panels)).toEqual({});
  });
});

describe('resolveAgentPageId', () => {
  const panels = [
    p('posts', { routes: [{ pattern: '/:postId', view: 'post-editor' }] }),
    p('widgets', {
      routes: [
        { pattern: '/regions', view: 'widget-regions', agentPageId: 'widget-regions' },
        { pattern: '/regions/:regionKey', view: 'region-editor', agentPageId: 'widget-regions' },
      ],
    }),
  ];

  it('reports the panel id for an index view', () => {
    expect(resolveAgentPageId(panels, 'posts', null)).toBe('posts');
  });

  it('reports the list page for a detail route with no override', () => {
    // `/posts/abc` -> `posts`, the nearest id an agent can act on.
    expect(resolveAgentPageId(panels, 'posts', 'post-editor')).toBe('posts');
  });

  it('reports the override for a route that has one', () => {
    // The documented bug: without this, navigating to `widget-regions` reported `widgets`.
    expect(resolveAgentPageId(panels, 'widgets', 'widget-regions')).toBe('widget-regions');
  });

  it('reports the override from a parameterized editor route too', () => {
    expect(resolveAgentPageId(panels, 'widgets', 'region-editor')).toBe('widget-regions');
  });

  it('returns null for an unmatched route', () => {
    expect(resolveAgentPageId(panels, null, null)).toBeNull();
  });
});
