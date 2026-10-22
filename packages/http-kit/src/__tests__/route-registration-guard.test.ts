import { describe, expect, it } from 'vitest';
import {
  getRouteRegistrationInventory,
  guardedRouteKey,
  installRouteRegistrationGuard,
} from '../route-registration-guard.js';

/** Mirrors the real Express app surface `installRouteRegistrationGuard` monkey-patches: eight
 * registration methods, each recording the (path, handlers) it was called with. */
function makeApp() {
  const calls: Record<string, Array<{ path: unknown; handlers: unknown[] }>> = {
    get: [],
    post: [],
    put: [],
    patch: [],
    delete: [],
    options: [],
    all: [],
    use: [],
  };
  const app = {
    get: (path: unknown, ...handlers: unknown[]) => calls.get!.push({ path, handlers }),
    post: (path: unknown, ...handlers: unknown[]) => calls.post!.push({ path, handlers }),
    put: (path: unknown, ...handlers: unknown[]) => calls.put!.push({ path, handlers }),
    patch: (path: unknown, ...handlers: unknown[]) => calls.patch!.push({ path, handlers }),
    delete: (path: unknown, ...handlers: unknown[]) => calls.delete!.push({ path, handlers }),
    options: (path: unknown, ...handlers: unknown[]) => calls.options!.push({ path, handlers }),
    all: (path: unknown, ...handlers: unknown[]) => calls.all!.push({ path, handlers }),
    use: (path: unknown, ...handlers: unknown[]) => calls.use!.push({ path, handlers }),
  };
  return { app, calls };
}

describe('guardedRouteKey', () => {
  it('returns the METHOD PATH key when the path is a guarded string', () => {
    const guarded = new Set(['POST /api/runs']);
    expect(guardedRouteKey({ method: 'post', path: '/api/runs', guardedRouteKeys: guarded })).toBe('POST /api/runs');
  });

  it('is case-insensitive on the method', () => {
    const guarded = new Set(['GET /api/x']);
    expect(guardedRouteKey({ method: 'GeT', path: '/api/x', guardedRouteKeys: guarded })).toBe('GET /api/x');
  });

  it('returns null when the path is not in the guarded set', () => {
    const guarded = new Set(['POST /api/runs']);
    expect(guardedRouteKey({ method: 'post', path: '/api/other', guardedRouteKeys: guarded })).toBeNull();
  });

  it('returns null for a non-string path (e.g. a RegExp route)', () => {
    const guarded = new Set(['GET /api/x']);
    expect(guardedRouteKey({ method: 'get', path: /\/api\/.*/, guardedRouteKeys: guarded })).toBeNull();
  });

  it('returns null against an empty guarded set', () => {
    expect(guardedRouteKey({ method: 'get', path: '/anything', guardedRouteKeys: new Set() })).toBeNull();
  });
});

describe('installRouteRegistrationGuard', () => {
  it('records every string-path registration across all eight guarded methods, in call order', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any });

    app.get('/a', () => { });
    app.post('/b', () => { });
    app.put('/c', () => { });
    app.patch('/d', () => { });
    app.delete('/e', () => { });
    app.options('/f', () => { });
    app.all('/g', () => { });
    app.use('/h', () => { });

    expect(getRouteRegistrationInventory({ app: app as any })).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
      { method: 'PUT', path: '/c' },
      { method: 'PATCH', path: '/d' },
      { method: 'DELETE', path: '/e' },
      { method: 'OPTIONS', path: '/f' },
      { method: 'ALL', path: '/g' },
      { method: 'USE', path: '/h' },
    ]);
  });

  it('still forwards the call to the original method with the same arguments', () => {
    const { app, calls } = makeApp();
    installRouteRegistrationGuard({ app: app as any });

    const handler = () => { };
    app.get('/a', handler);

    expect(calls.get).toEqual([{ path: '/a', handlers: [handler] }]);
  });

  it('does not record a non-string path in the inventory (e.g. a RegExp route)', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any });

    app.get(/\/api\/.*/, () => { });

    expect(getRouteRegistrationInventory({ app: app as any })).toEqual([]);
  });

  it('defaults to an empty guarded set: the same route can be registered any number of times without throwing', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any });

    expect(() => {
      app.post('/api/runs', () => { });
      app.post('/api/runs', () => { });
    }).not.toThrow();
  });

  it('throws on a second registration of a guarded route key', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any }, { guardedRouteKeys: new Set(['POST /api/runs']) });

    app.post('/api/runs', () => { });
    expect(() => app.post('/api/runs', () => { })).toThrowError(
      'duplicate guarded route registration: POST /api/runs',
    );
  });

  it('does not guard a route with the same path but a different method', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any }, { guardedRouteKeys: new Set(['POST /api/runs']) });

    expect(() => {
      app.post('/api/runs', () => { });
      app.get('/api/runs', () => { });
    }).not.toThrow();
  });

  it('allows an unguarded route to be registered repeatedly alongside a guarded one', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any }, { guardedRouteKeys: new Set(['POST /api/runs']) });

    expect(() => {
      app.get('/api/status', () => { });
      app.get('/api/status', () => { });
      app.post('/api/runs', () => { });
    }).not.toThrow();
  });
});

describe('getRouteRegistrationInventory', () => {
  it('isolates entry mutations as well as array mutations from later inventory reads', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any });
    app.get('/original', () => { });
    const first = getRouteRegistrationInventory({ app: app as any });
    const second = getRouteRegistrationInventory({ app: app as any });
    expect(first[0]).not.toBe(second[0]);
    first[0]!.method = 'DELETE';
    first[0]!.path = '/changed';
    expect(second).toEqual([{ method: 'GET', path: '/original' }]);
    app.post('/later', () => { });
    expect(getRouteRegistrationInventory({ app: app as any })).toEqual([{ method: 'GET', path: '/original' }, { method: 'POST', path: '/later' }]);
  });
  it('returns an empty array for an app the guard was never installed on', () => {
    const { app } = makeApp();
    expect(getRouteRegistrationInventory({ app: app as any })).toEqual([]);
  });

  it('returns a fresh copy each call — mutating the returned array never leaks into the guard state', () => {
    const { app } = makeApp();
    installRouteRegistrationGuard({ app: app as any });
    app.get('/a', () => { });

    const first = getRouteRegistrationInventory({ app: app as any });
    first.push({ method: 'GET', path: '/injected' });

    const second = getRouteRegistrationInventory({ app: app as any });
    expect(second).toEqual([{ method: 'GET', path: '/a' }]);
  });
});
