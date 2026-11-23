import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  siteActivateRoute, siteCreateRoute, siteTokenSignInPluginsRoute, SITE_ADMIN_REFUSAL_STATUS,
  type SiteActivateRouteDeps, type SiteCreateRouteDeps, type SiteSwitchBase,
} from '../sites.js';

const BASE = '/api/admin/v1/workspaces/:workspaceId/system/sites';
const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params: { workspaceId: 'ws', ...params } });

async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error('expected a route refusal');
}

function fixture({ gate = { ok: true, switcherBase: '/repo' } as SiteSwitchBase, deny = false } = {}) {
  const calls: unknown[] = [];
  const deps: SiteCreateRouteDeps & SiteActivateRouteDeps & { workspaceId: string; listTokenSignInPlugins: (r: { workspaceId: string }) => Promise<unknown> } = {
    workspaceId: 'ws',
    siteSwitchBase: () => { calls.push('gate'); return gate; },
    createSite: async (input) => { calls.push(['create', input]); return { ok: true, site: { name: input.name }, agentPluginTokens: [] }; },
    activateSite: async (input) => { calls.push(['activate', input]); return { ok: true, restartRequired: true }; },
    listTokenSignInPlugins: async (input) => { calls.push(['plugins', input]); return [{ id: 'p' }]; },
  };
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(['authorize', args]);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const run = async <I>(route: { parse: (r: ReturnType<typeof raw>) => { ok: boolean; value?: I }; handle: (a: never, o: object) => Promise<unknown> }, body: unknown, params?: Record<string, string>) => {
    const parsed = route.parse(raw(body, params));
    if (!parsed.ok) throw new Error('parse must be total');
    return route.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize } as never, {});
  };
  return { calls, deps, authorize, run };
}

describe('sites admin route specs', () => {
  it('pins method, path and success status', () => {
    expect([siteTokenSignInPluginsRoute.method, siteTokenSignInPluginsRoute.path, siteTokenSignInPluginsRoute.successStatus]).toEqual(['get', `${BASE}/token-sign-in-plugins`, undefined]);
    expect([siteCreateRoute.method, siteCreateRoute.path, siteCreateRoute.successStatus, siteCreateRoute.maxBodyBytes]).toEqual(['post', BASE, 201, undefined]);
    expect([siteActivateRoute.method, siteActivateRoute.path, siteActivateRoute.successStatus]).toEqual(['post', `${BASE}/:name/activate`, undefined]);
  });

  it('parse is total and reads only its own fields', () => {
    expect(siteCreateRoute.parse(raw({ name: 'a', adminPassword: 'pw', agentPluginTokens: { p: 't' }, extra: 1 })))
      .toEqual({ ok: true, value: { name: 'a', adminPassword: 'pw', agentPluginTokens: { p: 't' } } });
    expect(siteCreateRoute.parse(raw(null))).toEqual({ ok: true, value: { name: undefined, adminPassword: undefined, agentPluginTokens: undefined } });
    expect(siteCreateRoute.parse(raw({ name: 5 }))).toEqual({ ok: true, value: { name: undefined, adminPassword: undefined, agentPluginTokens: undefined } });
    expect(siteActivateRoute.parse(raw({ restartNow: 'yes' }, { name: 'b' }))).toEqual({ ok: true, value: { name: 'b', restartNow: false } });
    expect(siteActivateRoute.parse(raw({ restartNow: true }, {}))).toEqual({ ok: true, value: { name: '', restartNow: true } });
  });

  it('the switch gate refuses before any authorization, with the refusal body minus `ok`', async () => {
    for (const [code, status] of [['SITE_SWITCHING_DISABLED', 403], ['SITE_BINDING_NOT_SWITCHABLE', 409]] as const) {
      for (const route of ['create', 'activate'] as const) {
        const f = fixture({ gate: { ok: false, code, error: 'no' } });
        expect(await refusalOf(() => (route === 'create' ? f.run(siteCreateRoute as never, { name: 'a' }) : f.run(siteActivateRoute as never, {}, { name: 'a' }))))
          .toEqual({ status, body: { code, error: 'no' } });
        expect(f.calls).toEqual(['gate']);
      }
    }
  });

  it('authorizes system.write / system.read on site-registry with no entity id', async () => {
    const f = fixture();
    await f.run(siteCreateRoute as never, { name: 'a' });
    await f.run(siteActivateRoute as never, {}, { name: 'a' });
    await f.run(siteTokenSignInPluginsRoute as never, {});
    expect(f.calls.filter((call) => Array.isArray(call) && call[0] === 'authorize').map((call) => (call as unknown[])[1])).toEqual([
      { permission: 'system.write', entityType: 'site-registry' }, { permission: 'system.write', entityType: 'site-registry' },
      { permission: 'system.read', entityType: 'site-registry' },
    ]);
  });

  it('an authorization refusal stops every effect (and the create name check)', async () => {
    const f = fixture({ deny: true });
    await expect(f.run(siteCreateRoute as never, {})).rejects.toThrow(RouteRefusalError);
    await expect(f.run(siteActivateRoute as never, {}, { name: 'a' })).rejects.toThrow(RouteRefusalError);
    await expect(f.run(siteTokenSignInPluginsRoute as never, {})).rejects.toThrow(RouteRefusalError);
    expect(f.calls.filter((call) => Array.isArray(call) && call[0] !== 'authorize')).toEqual([]);
  });

  it('create: a missing name is a 400 VALIDATION_ERROR after authorization; success is the site + tokens', async () => {
    const f = fixture();
    expect(await refusalOf(() => f.run(siteCreateRoute as never, { name: 7 }))).toEqual({ status: 400, body: { error: "'name' (string) is required", code: 'VALIDATION_ERROR' } });
    expect(await f.run(siteCreateRoute as never, { name: 'a', adminPassword: 'pw' })).toEqual({ ok: true, value: { site: { name: 'a' }, agentPluginTokens: [] } });
    expect(f.calls.at(-1)).toEqual(['create', { switcherBase: '/repo', name: 'a', actorId: 'owner', adminPassword: 'pw', agentPluginTokens: undefined }]);
  });

  it('maps every feature refusal code to its status, body without `ok`', async () => {
    for (const [code, status] of Object.entries(SITE_ADMIN_REFUSAL_STATUS)) {
      const f = fixture();
      f.deps.createSite = async () => ({ ok: false, code, error: 'x', pluginId: 'p' });
      f.deps.activateSite = async () => ({ ok: false, code, error: 'x' });
      expect(await refusalOf(() => f.run(siteCreateRoute as never, { name: 'a' }))).toEqual({ status, body: { code, error: 'x', pluginId: 'p' } });
      expect(await refusalOf(() => f.run(siteActivateRoute as never, {}, { name: 'a' }))).toEqual({ status, body: { code, error: 'x' } });
    }
    expect(SITE_ADMIN_REFUSAL_STATUS).toEqual({ SITE_SWITCHING_DISABLED: 403, SITE_BINDING_NOT_SWITCHABLE: 409, VALIDATION_ERROR: 400, SITE_ALREADY_EXISTS: 409,
      SITE_NOT_FOUND: 404, SITE_ALREADY_RUNNING: 409, AGENT_PLUGIN_TOKEN_INVALID: 400, AGENT_PLUGIN_TOKEN_REFUSED: 400, AGENT_PLUGIN_TOKEN_UNSUPPORTED: 400 });
  });

  it('activate answers the whole activation (including `ok`) and passes the injected inputs', async () => {
    const f = fixture();
    expect(await f.run(siteActivateRoute as never, { restartNow: true }, { name: 'b' })).toEqual({ ok: true, value: { ok: true, restartRequired: true } });
    expect(f.calls.at(-1)).toEqual(['activate', { switcherBase: '/repo', name: 'b', restartNow: true }]);
  });

  it('token sign-in plugins: lists for the served workspace', async () => {
    const f = fixture();
    expect(await f.run(siteTokenSignInPluginsRoute as never, {})).toEqual({ ok: true, value: { plugins: [{ id: 'p' }] } });
    expect(f.calls.at(-1)).toEqual(['plugins', { workspaceId: 'ws' }]);
  });

  it('unexpected collaborator errors are rethrown unchanged; no authorizer or principal fails closed', async () => {
    const f = fixture();
    f.deps.createSite = async () => { throw new Error('disk full'); };
    await expect(f.run(siteCreateRoute as never, { name: 'a' })).rejects.toThrow('disk full');
    await expect(siteTokenSignInPluginsRoute.handle({ input: {}, deps: f.deps }, {})).rejects.toThrow(/no authorizer/);
    await expect(siteCreateRoute.handle({ input: { name: 'a', adminPassword: undefined, agentPluginTokens: undefined }, deps: f.deps, authorize: f.authorize }, {})).rejects.toThrow(/no authenticated principal/);
  });
});
