import { describe, expect, it } from 'vitest';
import type { AdminPanel } from '../manifest/types.js';
import { adminHref, currentRoutePath, matchRoute, stripTrailingSlash } from '../routing/rules.js';

const panel = (id: string, routes?: AdminPanel['routes']): AdminPanel<null> => ({
  id,
  render: null,
  ...(routes ? { routes } : {}),
});

const PANELS: readonly AdminPanel<null>[] = [
  panel('dashboard'),
  panel('settings'),
  panel('posts', [{ pattern: '/:postId', view: 'post-editor' }]),
  panel('widgets', [
    { pattern: '/regions/:regionKey', view: 'region-editor' },
    { pattern: '/regions', view: 'regions' },
    { pattern: '/new', view: 'widget-editor' },
    { pattern: '/:widgetId', view: 'widget-editor' },
  ]),
  panel('collections', [
    { pattern: '/:contentTypeKey/:entryId', view: 'entry-editor' },
    { pattern: '/:contentTypeKey', view: 'entries' },
  ]),
];

describe('adminHref / currentRoutePath', () => {
  it('round-trips a route path through a URL and back', () => {
    expect(adminHref({ routePath: '/settings' })).toBe('/admin/settings');
    expect(currentRoutePath({ pathname: '/admin/settings' })).toBe('/settings');
  });

  it('treats a bare base and a trailing-slash base as the dashboard', () => {
    expect(currentRoutePath({ pathname: '/admin' })).toBe('/');
    expect(currentRoutePath({ pathname: '/admin/' })).toBe('/');
  });

  it('normalizes a route path that is missing its leading slash', () => {
    expect(adminHref({ routePath: 'settings' })).toBe('/admin/settings');
  });

  it('honours a custom base so a product can mount elsewhere', () => {
    expect(adminHref({ routePath: '/settings' }, { base: '/manage' })).toBe('/manage/settings');
    expect(currentRoutePath({ pathname: '/manage/settings' }, { base: '/manage' })).toBe('/settings');
  });

  it('returns the whole path when mounted somewhere unexpected, rather than hiding the mismatch', () => {
    expect(currentRoutePath({ pathname: '/elsewhere/settings' })).toBe('/elsewhere/settings');
  });

  it('strips a trailing slash but leaves a lone root alone', () => {
    expect(stripTrailingSlash({ pathname: '/admin/settings/' })).toBe('/admin/settings');
    expect(stripTrailingSlash({ pathname: '/' })).toBe('/');
  });
});

describe('matchRoute', () => {
  it('resolves the root to the dashboard', () => {
    expect(matchRoute({ routePath: '/', panels: PANELS }).panelId).toBe('dashboard');
  });

  it('resolves a bare panel segment to its index view', () => {
    const route = matchRoute({ routePath: '/settings', panels: PANELS });
    expect(route).toMatchObject({ panelId: 'settings', view: null, params: {} });
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute({ routePath: '/settings/', panels: PANELS }).panelId).toBe('settings');
  });

  it('captures a detail-route param', () => {
    const route = matchRoute({ routePath: '/posts/abc', panels: PANELS });
    expect(route).toMatchObject({ panelId: 'posts', view: 'post-editor', params: { postId: 'abc' } });
  });

  it('captures multiple params', () => {
    const route = matchRoute({ routePath: '/collections/recipes/42', panels: PANELS });
    expect(route.params).toEqual({ contentTypeKey: 'recipes', entryId: '42' });
    expect(route.view).toBe('entry-editor');
  });

  it('prefers an earlier literal pattern over a later param pattern', () => {
    // `/widgets/new` must reach the `new` branch, not be captured as `:widgetId`. Declaration
    // order is the tiebreak, which is why `/new` is registered before `/:widgetId`.
    expect(matchRoute({ routePath: '/widgets/new', panels: PANELS }).params).toEqual({});
    expect(matchRoute({ routePath: '/widgets/w1', panels: PANELS }).params).toEqual({ widgetId: 'w1' });
  });

  it('matches a nested literal + param pattern', () => {
    const route = matchRoute({ routePath: '/widgets/regions/sidebar', panels: PANELS });
    expect(route).toMatchObject({ view: 'region-editor', params: { regionKey: 'sidebar' } });
  });

  it('falls through for an unregistered single segment rather than rendering an empty panel', () => {
    expect(matchRoute({ routePath: '/typo', panels: PANELS }).panelId).toBeNull();
  });

  it('falls through when a registered panel has unmatched trailing segments', () => {
    // `/posts/abc/typo` is a bad URL, not the posts index.
    expect(matchRoute({ routePath: '/posts/abc/typo', panels: PANELS }).panelId).toBeNull();
  });

  it('parses the query without letting it affect matching', () => {
    const route = matchRoute({ routePath: '/widgets/new?type=text', panels: PANELS });
    expect(route.view).toBe('widget-editor');
    expect(route.query.get('type')).toBe('text');
  });

  it('exposes an empty query when there is none', () => {
    expect([...matchRoute({ routePath: '/settings', panels: PANELS }).query.keys()]).toEqual([]);
  });

  it.each(['constructor', 'valueOf', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not resolve the prototype-chain member %s as a panel',
    (name) => {
      // A real bug in the ported original, which dispatched through a plain object and used
      // `key in SECTIONS`: `in` walks the prototype chain, so `/admin/constructor` and
      // `/admin/valueOf` returned a bare `{}` and crashed the render with "Objects are not valid
      // as a React child", `/admin/__proto__` threw, and `/admin/toString` rendered the literal
      // "[object Object]" as the page. Matching over an array of panels is immune by
      // construction; this test exists so a future rewrite to a keyed lookup cannot regress it.
      expect(matchRoute({ routePath: `/${name}`, panels: PANELS }).panelId).toBeNull();
    },
  );
});
