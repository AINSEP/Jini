import { describe, expect, it } from 'vitest';
import { pluginToolIdFor, validatePluginRoute } from '../../contributions.js';

/** L2 §4 contributions.ts: plugin route grammar (AP4) — every method, case, anchors, params,
 *  wildcards/regex/traversal refused, so a handler cannot widen its claim or leave /api/p/<id>. */
describe('validatePluginRoute', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('method %s allowed', (method) => {
    expect(() => validatePluginRoute({ method, path: '/' })).not.toThrow();
  });
  it.each(['get', 'TRACE', 'CONNECT', 'GETX', 'XGET', 'GET ', ' GET', ''])('method %j refused', (method) => {
    expect(() => validatePluginRoute({ method, path: '/' })).toThrow('unsupported plugin route method');
  });
  it.each(['/', '/a', '/a/', '/A-b_1/:id', '/:id/x/:y2', '/a/b/c'])('path %j allowed', (path) => {
    expect(() => validatePluginRoute({ method: 'GET', path })).not.toThrow();
  });
  it.each(['', 'a', '//', '/a//b', '/a/*', '/*', '/a/(.*)', '/:1d', '/:', '/a/../b', '/..', '/a.b', '/a b', '/a?x=1', '/a#f', '/a\n', 'x/a', '/a/:id?', '/a+', '/%2e%2e'])('path %j refused', (path) => {
    expect(() => validatePluginRoute({ method: 'GET', path })).toThrow('unsafe plugin route path');
  });
});

describe('pluginToolIdFor', () => {
  it('replaces every hyphen in the plugin id and keeps the tool name verbatim', () => {
    expect(pluginToolIdFor({ pluginId: 'a-b-c', name: 'do-it' })).toBe('p_a_b_c__do-it');
  });
});
