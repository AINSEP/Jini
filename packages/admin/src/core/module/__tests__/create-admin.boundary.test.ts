import { describe, it, expect } from 'vitest';
import { createAdmin, adminPort, AdminConfigError } from '../index.js';
import type { AdminOptions } from '../create-admin.js';
import type { AdminModule } from '../types.js';
import type { AdminPortToken } from '../token.js';

type Modules = readonly AdminModule[];
const boot = (
  modules: Modules,
  ports: Record<string, unknown> = {},
  options: AdminOptions<Modules> = {},
) => createAdmin({ modules, ports }, options);
const issuesOf = (run: () => unknown): readonly string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof AdminConfigError) return error.issues;
    throw error;
  }
  throw new Error('boot unexpectedly passed');
};
const token = (id: string, version = 1): AdminPortToken => ({
  id,
  version,
  cardinality: 'one',
});
const tracker = (log: string[], name: string) => ({
  dispose: () => log.push(name),
});

describe('createAdmin token validation', () => {
  it('rejects a token with an empty id', () => {
    const m: AdminModule = { id: 'm', optional: { p: token('') }, pages: {} };
    expect(issuesOf(() => boot([m]))).toEqual(['Invalid token: p']);
  });
  it('rejects a token whose cardinality is not one', () => {
    // @ts-expect-error JavaScript callers can hand a multi-cardinality token
    const bad: AdminPortToken = { id: 'p', version: 1, cardinality: 'many' };
    const m: AdminModule = { id: 'm', optional: { p: bad }, pages: {} };
    expect(issuesOf(() => boot([m]))).toEqual(['Invalid token: p']);
  });
  it('rejects a non-integer token version', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { p: token('p', 1.5) },
      pages: {},
    };
    expect(issuesOf(() => boot([m]))).toEqual(['Invalid token: p']);
  });
  it('rejects a token version below 1', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { p: token('p', 0) },
      pages: {},
    };
    expect(issuesOf(() => boot([m]))).toEqual(['Invalid token: p']);
  });
  it('accepts a token version of exactly 1', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { p: token('p', 1) },
      pages: {},
    };
    expect(boot([m]).describe().modules).toEqual(['m']);
  });
  it('rejects the same name bound to a different token id', () => {
    const a: AdminModule = { id: 'a', optional: { p: token('x') }, pages: {} };
    const b: AdminModule = { id: 'b', optional: { p: token('y') }, pages: {} };
    expect(issuesOf(() => boot([a, b]))).toEqual(['Incompatible token: p']);
  });
  it('rejects one token id published under two names', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { p: token('x'), q: token('x') },
      pages: {},
    };
    expect(issuesOf(() => boot([m]))).toEqual(['Token x has conflicting names: p, q']);
  });
  it('de-duplicates repeated issues', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { p: token('') },
      requires: { p: token('') },
      pages: {},
    };
    expect(issuesOf(() => boot([m], { p: 1 }))).toEqual(['Invalid token: p']);
  });
  it('lists every issue in the error message', () => {
    const m: AdminModule = { id: 'm', optional: { p: token('') }, pages: {} };
    expect(() => boot([m], { typo: 1 })).toThrow(
      'Invalid admin configuration:\n- Invalid token: p\n- Unknown port: typo',
    );
  });
});

describe('createAdmin provider validation', () => {
  it('rejects two modules providing the same name', () => {
    const make = (id: string): AdminModule => ({
      id,
      provides: { s: token('s') },
      factories: { s: () => 1 },
      pages: {},
    });
    expect(issuesOf(() => boot([make('a'), make('b')]))).toEqual(['Duplicate provider: s']);
  });
  it('rejects a provided name with neither a factory nor a host value', () => {
    const m: AdminModule = { id: 'm', provides: { s: token('s') }, pages: {} };
    expect(issuesOf(() => boot([m]))).toEqual(['Missing provider factory: s']);
  });
  it('accepts a factory-less provider when the host overrides it', () => {
    const m: AdminModule = { id: 'm', provides: { s: token('s') }, pages: {} };
    const admin = boot([m], { s: 'host' }, { overrides: ['s'] });
    expect(admin.describe().ports).toEqual([{ name: 's', token: 's', version: 1, source: 'host' }]);
  });
  it('rejects a factory for an undeclared provider', () => {
    const m: AdminModule = { id: 'm', factories: { s: () => 1 }, pages: {} };
    expect(issuesOf(() => boot([m]))).toEqual(['Undeclared provider factory: s']);
  });
  it('rejects an override naming no provider', () => {
    expect(issuesOf(() => boot([], {}, { overrides: ['ghost'] }))).toEqual([
      'Unknown provider override: ghost',
    ]);
  });
  it('rejects a required tab port that nobody supplies', () => {
    const m: AdminModule = {
      id: 'm',
      pages: {
        p: {
          path: '/p',
          label: 'P',
          tabs: { t: { label: 'T', requires: { r: token('r') } } },
        },
      },
    };
    expect(issuesOf(() => boot([m]))).toEqual(['Missing port: r']);
  });
  it('accepts a required port supplied by a provider module', () => {
    const user: AdminModule = {
      id: 'u',
      requires: { s: token('s') },
      pages: {},
    };
    const maker: AdminModule = {
      id: 'p',
      provides: { s: token('s') },
      factories: { s: () => 7 },
      pages: {},
    };
    expect(boot([user, maker]).scope({ module: user })).toEqual({ s: 7 });
  });
  it('skips ordering a provider whose dependency the host already supplies', () => {
    const maker: AdminModule = {
      id: 'p',
      requires: { h: token('h') },
      provides: { s: token('s') },
      factories: { s: ({ ports }) => `from ${String(ports.h)}` },
      pages: {},
    };
    expect(boot([maker], { h: 'host' }).scope({ module: maker })).toEqual({
      h: 'host',
    });
  });
  it('skips constructing an overridden provider', () => {
    let ran = false;
    const maker: AdminModule = {
      id: 'p',
      provides: { s: token('s') },
      factories: {
        s: () => {
          ran = true;
          return 1;
        },
      },
      pages: {},
    };
    boot([maker], { s: 2 }, { overrides: ['s'] });
    expect(ran).toBe(false);
  });
});

describe('createAdmin provider construction', () => {
  const chain = (log: string[], second: () => unknown): AdminModule[] => [
    {
      id: 'first',
      provides: { a: token('a') },
      factories: { a: () => tracker(log, 'a') },
      pages: {},
    },
    {
      id: 'second',
      requires: { a: token('a') },
      provides: { b: token('b') },
      factories: { b: second },
      pages: {},
    },
  ];
  it('passes narrowed ports and a copy of the grants to factories', () => {
    let seen: unknown;
    const m: AdminModule = {
      id: 'm',
      requires: { h: token('h') },
      provides: { s: token('s') },
      factories: {
        s: (args) => {
          seen = args;
          return 1;
        },
      },
      pages: {},
    };
    const other: AdminModule = {
      id: 'o',
      optional: { other: token('other') },
      pages: {},
    };
    boot([m, other], { h: 'host', other: 'hidden' }, { permissions: ['read'] });
    expect(seen).toEqual({ ports: { h: 'host' }, permissions: ['read'] });
  });
  it('rejects a factory returning nothing and disposes what was built', () => {
    const log: string[] = [];
    expect(issuesOf(() => boot(chain(log, () => undefined)))).toEqual([
      'Provider returned no value: b',
    ]);
    expect(log).toEqual(['a']);
  });
  it('wraps a thrown Error message as a config issue', () => {
    const log: string[] = [];
    const fail = () => {
      throw new Error('boom');
    };
    expect(issuesOf(() => boot(chain(log, fail)))).toEqual(['boom']);
  });
  it('wraps a thrown non-Error with a generic issue', () => {
    const fail = () => {
      throw 'nope';
    };
    expect(issuesOf(() => boot(chain([], fail)))).toEqual(['Provider initialization failed']);
  });
  it('disposes built providers in reverse construction order', () => {
    const log: string[] = [];
    const fail = () => {
      throw new Error('stop');
    };
    const third: AdminModule = {
      id: 'third',
      requires: { b: token('b') },
      provides: { c: token('c') },
      factories: { c: fail },
      pages: {},
    };
    issuesOf(() => boot([...chain(log, () => tracker(log, 'b')), third]));
    expect(log).toEqual(['b', 'a']);
  });
  it('does not treat a non-function dispose field as disposable', () => {
    const m: AdminModule = {
      id: 'm',
      provides: { s: token('s') },
      factories: { s: () => ({ dispose: 'no' }) },
      pages: {},
    };
    expect(() => boot([m]).dispose()).not.toThrow();
  });
  it('does not treat a primitive value as disposable', () => {
    const m: AdminModule = {
      id: 'm',
      provides: { s: token('s') },
      factories: { s: () => 3 },
      pages: {},
    };
    expect(() => boot([m]).dispose()).not.toThrow();
  });
  it('disposes providers in reverse order exactly once', () => {
    const log: string[] = [];
    const admin = boot(chain(log, () => tracker(log, 'b')));
    admin.dispose();
    admin.dispose();
    expect(log).toEqual(['b', 'a']);
  });
});

describe('createAdmin description', () => {
  const page = (tabs: AdminModule['pages'][string]['tabs'], extra = {}) => ({
    id: 'm',
    pages: { p: { path: '/p', label: 'P', tabs, ...extra } },
  });
  const tabOf = (m: AdminModule, ports: Record<string, unknown> = {}, permissions: string[] = []) =>
    boot([m], ports, { permissions }).describe().pages[0]?.tabs[0];
  it('shows a granted tab with no reason and default params', () => {
    expect(tabOf(page({ t: { label: 'T' } }))).toEqual({
      id: 'm.p.t',
      label: 'T',
      visible: true,
      reason: null,
      params: {},
      agentReachable: false,
    });
  });
  it('hides a tab whose page permission is not granted', () => {
    expect(tabOf(page({ t: { label: 'T' } }, { permissions: ['x'] }))?.reason).toBe(
      'permission denied',
    );
  });
  it('hides a tab whose own permission is not granted', () => {
    expect(tabOf(page({ t: { label: 'T', permissions: ['x'] } }))?.reason).toBe(
      'permission denied',
    );
  });
  it('shows a tab once its permission is granted', () => {
    expect(tabOf(page({ t: { label: 'T', permissions: ['x'] } }), {}, ['x'])?.visible).toBe(true);
  });
  it('hides a tab whose optional port is unwired', () => {
    expect(tabOf(page({ t: { label: 'T', optional: { o: token('o') } } }))?.reason).toBe(
      'optional port unavailable: o',
    );
  });
  it('shows a tab whose optional port is wired', () => {
    expect(tabOf(page({ t: { label: 'T', optional: { o: token('o') } } }), { o: 1 })?.reason).toBe(
      null,
    );
  });
  it('makes a tab agent-reachable only when page and tab both opt in', () => {
    const m = page({ t: { label: 'T', agentReachable: true } }, { agentReachable: true });
    expect(tabOf(m)?.agentReachable).toBe(true);
  });
  it('keeps a tab unreachable when only the tab opts in', () => {
    expect(tabOf(page({ t: { label: 'T', agentReachable: true } }))?.agentReachable).toBe(false);
  });
  it('keeps a hidden tab unreachable for agents', () => {
    const m = page(
      { t: { label: 'T', agentReachable: true, permissions: ['x'] } },
      { agentReachable: true },
    );
    expect(tabOf(m)?.agentReachable).toBe(false);
  });
  it('passes tab params through', () => {
    expect(tabOf(page({ t: { label: 'T', params: { k: 1 } } }))?.params).toEqual({ k: 1 });
  });
  it('describes a granted, agent-reachable page with nav', () => {
    const m = page({}, { permissions: ['x'], agentReachable: true, nav: { group: 'g' } });
    expect(boot([m], {}, { permissions: ['x'] }).describe().pages[0]).toEqual({
      id: 'm.p',
      path: '/p',
      label: 'P',
      visible: true,
      agentReachable: true,
      permissions: ['x'],
      grants: ['x'],
      nav: { group: 'g' },
      tabs: [],
    });
  });
  it('omits nav and defaults permissions for a plain page', () => {
    const described = boot([page({})]).describe().pages[0];
    expect(described).not.toHaveProperty('nav');
    expect(described?.permissions).toEqual([]);
  });
  it('lists only wired ports with their source', () => {
    const m: AdminModule = {
      id: 'm',
      optional: { h: token('h'), gone: token('gone') },
      provides: { s: token('s', 2) },
      factories: { s: () => 1 },
      pages: {},
    };
    expect(boot([m], { h: 1 }).describe().ports).toEqual([
      { name: 'h', token: 'h', version: 1, source: 'host' },
      { name: 's', token: 's', version: 2, source: 'module' },
    ]);
  });
});

describe('createAdmin scope', () => {
  it('refuses a module that was not booted', () => {
    const stranger: AdminModule = { id: 'stranger', pages: {} };
    expect(() => boot([]).scope({ module: stranger })).toThrow(
      'Module scope unavailable: stranger',
    );
  });
  it('includes tab ports in the scope', () => {
    const m: AdminModule = {
      id: 'm',
      pages: {
        p: {
          path: '/p',
          label: 'P',
          tabs: { t: { label: 'T', optional: { o: token('o') } } },
        },
      },
    };
    expect(boot([m], { o: 5 }).scope({ module: m })).toEqual({ o: 5 });
  });
});
