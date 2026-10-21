import { describe, expect, it } from 'vitest';
import { ToolInputError, type ApprovalAnswer, type RememberedApprovalPort, type ToolExecutionContext, type ToolRegistration } from '@jini-ai/core';
import { createProviderRegistry } from '@jini-ai/core/provider-registry';
import { SEARCH_CONTRACT, type SearchProvider } from '../contract.js';
import type { SearchService, SearchStatus } from '../api.js';
import type { SearchSiteTargets, SearchTarget } from '../ports.js';
import { buildSearchToolRegistrations, catalog, SEARCH_MANAGE_PERMISSION, SEARCH_READ_PERMISSION, type SearchApprovalDescription } from '../tools.js';
import { makeProvider, SITE, WS } from './fakes/index.js';

const ZERO = { pending: 0, indexed: 0, unknown: 0, failed: 0 };
const ACTIVE: SearchTarget = { siteId: SITE, providerId: 'vendor', generation: 1 };

interface SetupOptions {
  active?: string | null;
  providers?: string[];
  answer?: ApprovalAnswer;
  remembered?: RememberedApprovalPort;
  rebuildResult?: SearchSiteTargets;
}

function setup(options: SetupOptions = {}) {
  const registry = createProviderRegistry<SearchProvider>({ contract: SEARCH_CONTRACT });
  for (const id of options.providers ?? ['vendor', 'builtin']) registry.register({ definition: { id, provider: makeProvider({ id }).provider } });
  const activeId = options.active === undefined ? 'vendor' : options.active;
  const status: SearchStatus = { siteId: SITE, active: activeId === null ? null : { providerId: activeId, generation: 1, registered: registry.has({ id: activeId }), counts: ZERO }, building: null };
  const queries: unknown[] = [];
  const service: SearchService = {
    async query(required, optional) { queries.push({ required, optional }); return { status: 'ok', providerId: 'vendor', page: { hits: [] } }; },
    async status() { return status; },
  };
  const rebuilds: unknown[] = [];
  const indexer = {
    async startRebuild(required: { siteId: string; workspaceId: string; providerId: string }) {
      rebuilds.push(required);
      return options.rebuildResult ?? { active: ACTIVE, building: { siteId: SITE, providerId: required.providerId, generation: 2 } };
    },
  };
  const permissions: string[] = [];
  const asked: SearchApprovalDescription[] = [];
  const settings: unknown[] = [];
  const registrations = buildSearchToolRegistrations({
    workspaceId: WS, siteId: SITE, service, indexer, registry,
    requirePermission: async ({ permission }) => { permissions.push(permission); },
    askHuman: async ({ description }) => { asked.push(description); return options.answer ?? { confirmed: true }; },
    setProviderSetting: async required => { settings.push(required); },
  }, options.remembered ? { remembered: options.remembered } : {});
  const byId = new Map(registrations.map(r => [r.descriptor.id, r] as const));
  const call = (toolId: string, input: unknown = {}) => {
    const ctx: ToolExecutionContext = { executionId: 'e1', principal: { id: 'user-1' }, run: { id: 'run-1' }, input, signal: new AbortController().signal };
    return (byId.get(toolId) as ToolRegistration).handler(ctx);
  };
  return { registrations, call, queries, rebuilds, permissions, asked, settings };
}

function rememberedStore(granted: string[] = []) {
  const keys = new Set(granted);
  const checks: string[] = [];
  const port: RememberedApprovalPort = {
    async has({ key }) { checks.push(key); return keys.has(key); },
    async grant({ key }) { keys.add(key); },
  };
  return { port, keys, checks };
}

describe('search tool registrations', () => {
  it('registers four underscore-named tools with closed input schemas and corroborated risk', () => {
    const { registrations } = setup();
    expect(registrations.map(r => [r.descriptor.id, r.descriptor.readOnly, r.descriptor.sideEffects])).toEqual([
      ['search_query', true, 'none'],
      ['search_status', true, 'none'],
      ['search_reindex', false, 'mutates-durable-state'],
      ['search_set_provider', false, 'mutates-durable-state'],
    ]);
    for (const entry of catalog) {
      expect(entry.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(entry.description).toMatch(/Returns/);
    }
    expect(catalog[0]!.description).toMatch(/PUBLIC content only/);
  });
});

describe('search_query', () => {
  it('queries this site with the parsed input and NEVER passes audiences', async () => {
    const { call, queries, permissions } = setup();
    const input = { text: 'hello', collections: ['post'], locale: 'en', filters: { tag: 'x', n: 1, b: true }, limit: 500, cursor: 'c1' };
    expect(await call('search_query', input)).toEqual({ status: 'ok', providerId: 'vendor', page: { hits: [] } });
    expect(queries).toEqual([{ required: { siteId: SITE, workspaceId: WS, query: { text: 'hello', limit: 100, collections: ['post'], locale: 'en', filters: { tag: 'x', n: 1, b: true }, cursor: 'c1' } }, optional: undefined }]);
    expect(permissions).toEqual([SEARCH_READ_PERMISSION]);
  });

  it('defaults the limit and omits absent optional fields, even an audiences field the model sends', async () => {
    const { call, queries } = setup();
    await call('search_query', { text: 'hi', audiences: ['members'] });
    expect(queries).toEqual([{ required: { siteId: SITE, workspaceId: WS, query: { text: 'hi', limit: 10 } }, optional: undefined }]);
  });

  it('refuses malformed input as ToolInputError before checking permission or querying', async () => {
    const { call, queries, permissions } = setup();
    for (const input of [null, {}, { text: '' }, { text: 'x', collections: 'post' }, { text: 'x', collections: [1] }, { text: 'x', filters: null }, { text: 'x', filters: [] }, { text: 'x', filters: 'a' }, { text: 'x', filters: { a: {} } }, { text: 'x', limit: 0 }]) {
      await expect(call('search_query', input)).rejects.toBeInstanceOf(ToolInputError);
    }
    expect(queries).toEqual([]);
    expect(permissions).toEqual([]);
  });
});

describe('search_status', () => {
  it('returns the service status after a read permission check and refuses input', async () => {
    const { call, permissions } = setup();
    expect(await call('search_status')).toMatchObject({ siteId: SITE, active: { providerId: 'vendor' } });
    expect(permissions).toEqual([SEARCH_READ_PERMISSION]);
    await expect(call('search_status', { verbose: true })).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe('search_reindex', () => {
  it('asks, then rebuilds the active provider; permission is re-checked after the human answers', async () => {
    const { call, asked, rebuilds, permissions } = setup();
    expect(await call('search_reindex')).toEqual({ started: true, providerId: 'vendor', generation: 2 });
    expect(asked).toEqual([{ action: 'reindex', siteId: SITE, providerId: 'vendor', fromProviderId: 'vendor', summary: "Rebuild the search index in 'vendor' (writes every public document to it)." }]);
    expect(rebuilds).toEqual([{ siteId: SITE, workspaceId: WS, providerId: 'vendor' }]);
    expect(permissions).toEqual([SEARCH_MANAGE_PERMISSION, SEARCH_MANAGE_PERMISSION]);
  });

  it('does not rebuild when the human declines', async () => {
    const { call, rebuilds } = setup({ answer: { confirmed: false, reason: 'declined' } });
    expect(await call('search_reindex')).toEqual({ started: false, reason: 'declined' });
    expect(rebuilds).toEqual([]);
  });

  it('remembers a yes per provider, and a remembered grant skips the question', async () => {
    const store = rememberedStore();
    const first = setup({ remembered: store.port });
    await first.call('search_reindex');
    expect(store.keys).toEqual(new Set(['search_reindex:vendor']));
    const second = setup({ remembered: store.port });
    expect(await second.call('search_reindex')).toMatchObject({ started: true });
    expect(second.asked).toEqual([]);
    expect(second.rebuilds).toHaveLength(1);
  });

  it('refuses without asking when no provider is active or the active one is not loaded', async () => {
    const none = setup({ active: null });
    expect(await none.call('search_reindex')).toEqual({ started: false, code: 'not_configured', message: 'search has no active provider yet; use search_set_provider' });
    const gone = setup({ active: 'gone' });
    expect(await gone.call('search_reindex')).toEqual({ started: false, code: 'provider_not_registered', message: "the active search provider 'gone' is not loaded" });
    expect([...none.asked, ...gone.asked, ...none.rebuilds, ...gone.rebuilds]).toEqual([]);
  });

  it('reports a null generation when the rebuild left no building target', async () => {
    const { call } = setup({ rebuildResult: { active: ACTIVE, building: null } });
    expect(await call('search_reindex')).toEqual({ started: true, providerId: 'vendor', generation: null });
  });

  it('refuses input', async () => {
    await expect(setup().call('search_reindex', { force: true })).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe('search_set_provider', () => {
  it('asks every time, then persists the setting and rebuilds into the new provider', async () => {
    const store = rememberedStore(['search_reindex:builtin']);
    const { call, asked, settings, rebuilds } = setup({ remembered: store.port });
    expect(await call('search_set_provider', { providerId: 'builtin' })).toEqual({ started: true, providerId: 'builtin', generation: 2 });
    expect(asked).toEqual([{ action: 'set_provider', siteId: SITE, providerId: 'builtin', fromProviderId: 'vendor', summary: "Switch site search from 'vendor' to 'builtin' and copy every public document into it." }]);
    expect(settings).toEqual([{ siteId: SITE, providerId: 'builtin', principalId: 'user-1' }]);
    expect(rebuilds).toEqual([{ siteId: SITE, workspaceId: WS, providerId: 'builtin' }]);
    // Never remembered: the grant store is neither consulted nor written.
    expect(store.checks).toEqual([]);
    expect(store.keys).toEqual(new Set(['search_reindex:builtin']));
  });

  it('names "none" as the current provider when search was never configured', async () => {
    const { call, asked } = setup({ active: null });
    await call('search_set_provider', { providerId: 'vendor' });
    expect(asked[0]).toMatchObject({ fromProviderId: null, summary: "Switch site search from 'none' to 'vendor' and copy every public document into it." });
  });

  it('does not change the setting when the human declines', async () => {
    const { call, settings, rebuilds } = setup({ answer: { confirmed: false, reason: 'expired' } });
    expect(await call('search_set_provider', { providerId: 'builtin' })).toEqual({ started: false, reason: 'expired' });
    expect([...settings, ...rebuilds]).toEqual([]);
  });

  it('rejects an unregistered provider id as an input error listing the registered ids', async () => {
    const { call, asked, settings } = setup();
    await expect(call('search_set_provider', { providerId: 'algolia' })).rejects.toThrow(new ToolInputError({ message: "unknown search provider 'algolia'; registered: vendor, builtin" }));
    await expect(setup({ providers: [] }).call('search_set_provider', { providerId: 'x' })).rejects.toThrow("registered: none");
    await expect(call('search_set_provider', {})).rejects.toBeInstanceOf(ToolInputError);
    expect([...asked, ...settings]).toEqual([]);
  });
});
