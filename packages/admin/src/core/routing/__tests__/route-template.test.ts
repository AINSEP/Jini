import { describe, expect, it } from 'vitest';
import { toRouteTemplate } from '../route-template.js';

describe('toRouteTemplate', () => {
  it('replaces captured params, decodes matches, keeps malformed segments, and handles the root', () => {
    expect(toRouteTemplate({ base: '/admin', routePath: '/posts/abc123?tab=seo', params: { postId: 'abc123' } })).toBe('/admin/posts/:postId');
    expect(toRouteTemplate({ base: '/admin', routePath: '/widgets/regions/sidebar%20left', params: { regionKey: 'sidebar left' } })).toBe('/admin/widgets/regions/:regionKey');
    expect(toRouteTemplate({ base: '/admin', routePath: '/', params: {} })).toBe('/admin');
    expect(toRouteTemplate({ base: '/admin', routePath: '/bad%E0', params: {} })).toBe('/admin/bad%E0');
  });

  it('drops fragments and keeps unmatched segments encoded', () => {
    expect(toRouteTemplate({ base: '/control', routePath: '//records//a%20b#private?value=x', params: {} })).toBe('/control/records/a%20b');
  });

  it('joins the supplied base and segments without normalizing the base', () => {
    expect(toRouteTemplate({ base: '/x', routePath: 'a', params: {} })).toBe('/x/a');
    expect(toRouteTemplate({ base: '/x/', routePath: 'a', params: {} })).toBe('/x//a');
  });
});
