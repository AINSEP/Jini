import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  localSiteLifecycleRoutes, localSiteStartRoute, localSiteStopRoute, localSiteTrashRoute,
  localSiteTrashRestoreRoute, localSiteTrashDeleteRoute, type LocalSiteLifecycleRouteDeps,
} from '../local-sites.js';

const PREFIX = '/api/admin/v1/workspaces/:workspaceId/system/sites';
class FakeSiteError extends Error { constructor(readonly code: string) { super(code); } }
const STATE = { name: 'alpha', status: 'stopped' };

function fixture(overrides: Partial<LocalSiteLifecycleRouteDeps> = {}, { deny = false }: { deny?: boolean } = {}) {
  const calls: unknown[] = [];
  const deps: LocalSiteLifecycleRouteDeps = {
    siteSwitchBase: () => ({ ok: true, switcherBase: '/repo' }),
    localSiteSupervisor: {
      async start(input) { calls.push(['start', input]); return STATE; },
      async stop(input) { calls.push(['stop', input]); return STATE; },
      async withStoppedSite({ name, task }) { calls.push(['stopped', name]); return task(); },
    },
    siteTrash: {
      trash(input) { calls.push(['trash', input]); return { name: input.name, id: 'trash-id' }; },
      restore(input) { calls.push(['restore', input]); },
      remove(input) { calls.push(['remove', input]); },
    },
    siteTrashName: ({ id }) => id.split('--')[0] ?? '',
    localSiteErrorCode: (error) => (error instanceof FakeSiteError ? error.code : undefined),
    afterTrash(input) { calls.push(['afterTrash', input]); },
    ...overrides,
  };
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(['authorize', args]);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  async function run(route: (typeof localSiteLifecycleRoutes)[number], params: Record<string, string>, body: unknown = {}) {
    const parsed = route.parse({ body, query: {}, params: { workspaceId: 'ws', ...params } });
    if (!parsed.ok) throw new Error('parse must be total');
    return route.handle({ input: parsed.value, deps, context: { id: 'operator' }, authorize }, {});
  }
  return { calls, run, deps };
}

async function refusal(promise: Promise<unknown>): Promise<RouteRefusalError['response']> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  if (!(error instanceof RouteRefusalError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.response;
}

describe('local site lifecycle routes', () => {
  it('keeps every method and byte-identical path in registration order', () => {
    expect(localSiteLifecycleRoutes.map(r => `${r.method} ${r.path}`)).toEqual([
      `post ${PREFIX}/:name/start`, `post ${PREFIX}/:name/stop`, `post ${PREFIX}/:name/trash`,
      `post ${PREFIX}/trash/:id/restore`, `post ${PREFIX}/trash/:id/delete`,
    ]);
  });

  it('start/stop authorize system.write on site-registry and return the supervisor payload', async () => {
    const f = fixture();
    expect(await f.run(localSiteStartRoute, { name: 'alpha' })).toEqual({ ok: true, value: STATE });
    expect(await f.run(localSiteStopRoute, { name: 'alpha' })).toEqual({ ok: true, value: STATE });
    expect(f.calls).toEqual([
      ['authorize', { permission: 'system.write', entityType: 'site-registry' }], ['start', { name: 'alpha' }],
      ['authorize', { permission: 'system.write', entityType: 'site-registry' }], ['stop', { name: 'alpha' }],
    ]);
  });

  it('a missing :name reaches the supervisor as an empty name', async () => {
    const f = fixture();
    const parsed = localSiteStartRoute.parse({ body: undefined, query: {}, params: {} });
    expect(parsed).toEqual({ ok: true, value: { name: '', id: '', checked: false, confirmed: false } });
    await f.run(localSiteStartRoute, {});
    expect(f.calls.at(-1)).toEqual(['start', { name: '' }]);
  });

  it('the switch gate refuses before authorizing: 403 when disabled, 409 otherwise, body verbatim', async () => {
    const disabled = { ok: false as const, code: 'SITE_SWITCHING_DISABLED', error: 'off' };
    const f = fixture({ siteSwitchBase: () => disabled });
    expect(await refusal(f.run(localSiteStartRoute, { name: 'alpha' }))).toEqual({ status: 403, body: disabled });
    const binding = { ok: false as const, code: 'SITE_BINDING_NOT_SWITCHABLE', error: 'bound' };
    const g = fixture({ siteSwitchBase: () => binding });
    expect(await refusal(g.run(localSiteStartRoute, { name: 'alpha' }))).toEqual({ status: 409, body: binding });
    expect([...f.calls, ...g.calls]).toEqual([]);
  });

  it('an authorization refusal passes through untouched, before the host check', async () => {
    const f = fixture({ localSiteSupervisor: undefined }, { deny: true });
    expect(await refusal(f.run(localSiteStartRoute, { name: 'alpha' }))).toEqual({ status: 403, body: { error: 'denied' } });
  });

  it('a missing local site host is a 409 after authorizing', async () => {
    const f = fixture({ localSiteSupervisor: undefined });
    expect(await refusal(f.run(localSiteStartRoute, { name: 'alpha' }))).toEqual({
      status: 409, body: { code: 'SITE_HOST_UNAVAILABLE', error: 'local site host is unavailable' },
    });
    expect(f.calls).toEqual([['authorize', { permission: 'system.write', entityType: 'site-registry' }]]);
  });

  it('maps typed site errors through the status table (unmapped codes are 500) and rethrows opaque ones', async () => {
    for (const [code, status] of [['VALIDATION_ERROR', 400], ['SITE_NOT_FOUND', 404], ['SITE_RUNNING', 409], ['SITE_HOST_STOPPING', 500]] as const) {
      const f = fixture({ afterTrash: () => { throw new FakeSiteError(code); } });
      expect(await refusal(f.run(localSiteTrashRoute, { name: 'alpha' }, { confirmed: true }))).toEqual({ status, body: { code, error: code } });
    }
    const opaque = new Error('private');
    const f = fixture({ afterTrash: () => { throw opaque; } });
    await expect(f.run(localSiteTrashRoute, { name: 'alpha' }, { confirmed: true })).rejects.toBe(opaque);
  });

  it('trash requires confirmation, then trashes inside the stopped site and runs afterTrash', async () => {
    const f = fixture();
    expect(await refusal(f.run(localSiteTrashRoute, { name: 'alpha' }, {}))).toEqual({ status: 400, body: { code: 'SITE_CONFIRM_REQUIRED', error: 'SITE_CONFIRM_REQUIRED' } });
    expect(f.calls).toEqual([['authorize', { permission: 'system.write', entityType: 'site-registry' }]]);
    expect(await f.run(localSiteTrashRoute, { name: 'alpha' }, { confirmed: true })).toEqual({ ok: true, value: { site: { name: 'alpha', id: 'trash-id' } } });
    expect(f.calls.slice(-3)).toEqual([['stopped', 'alpha'], ['trash', { base: '/repo', name: 'alpha' }], ['afterTrash', { base: '/repo', name: 'alpha' }]]);
    const noHook = fixture({ afterTrash: undefined });
    expect((await noHook.run(localSiteTrashRoute, { name: 'alpha' }, { confirmed: true })).ok).toBe(true);
  });

  it('restore answers {ok:true} for a nullish result', async () => {
    const f = fixture();
    expect(await f.run(localSiteTrashRestoreRoute, { id: 'alpha--1' })).toEqual({ ok: true, value: { ok: true } });
    expect(f.calls.slice(-2)).toEqual([['stopped', 'alpha'], ['restore', { base: '/repo', id: 'alpha--1' }]]);
  });

  it('permanent delete requires both checked and confirmed', async () => {
    for (const body of [{}, { checked: true }, { confirmed: true }, null]) {
      const f = fixture();
      expect(await refusal(f.run(localSiteTrashDeleteRoute, { id: 'alpha--1' }, body))).toEqual({ status: 400, body: { code: 'SITE_CONFIRM_REQUIRED', error: 'SITE_CONFIRM_REQUIRED' } });
    }
    const f = fixture();
    expect(await f.run(localSiteTrashDeleteRoute, { id: 'alpha--1' }, { checked: true, confirmed: true })).toEqual({ ok: true, value: { ok: true } });
    expect(f.calls.slice(-2)).toEqual([['stopped', 'alpha'], ['remove', { base: '/repo', id: 'alpha--1', checked: true, confirmed: true }]]);
  });
});

it('fails closed without an authorizer before starting a local site', async () => {
  const { deps, calls } = fixture();
  await expect(localSiteStartRoute.handle({
    input: { name: 'alpha', id: '', confirmed: false, checked: false }, deps, context: { id: 'operator' },
  })).rejects.toThrow('local site lifecycle route has no authorizer');
  expect(calls).toEqual([]);
});
