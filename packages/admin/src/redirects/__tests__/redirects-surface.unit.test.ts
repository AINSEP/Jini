import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminRedirect, AdminRedirectCreateInput } from '../../core/ports/redirects.js';
import * as redirects from '../index.js';
import { createHttpRedirectsApi, type RedirectsTransportPort } from '../adapters/http.js';
import { createMemoryRedirectsApi } from '../adapters/memory.js';

const input: AdminRedirectCreateInput = { fromPattern: '/old', toTarget: '/new', statusCode: 301, matchType: 'exact' };

/** A complete, backend-shaped row (the memory adapter stamps every field) instead of a partial cast. */
async function realRow(status: AdminRedirect['status'] = 'active'): Promise<AdminRedirect> {
  const api = createMemoryRedirectsApi({});
  const row = await api.createRedirect(input);
  return status === 'active' ? row : api.tombstoneRedirect({ id: row.id });
}

function recordingTransport(reply: unknown = { data: { id: 'r1' } }) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const transport: RedirectsTransportPort = {
    async request<T>(required: { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) {
      calls.push(required);
      return reply as T;
    },
    url: ({ path }) => `https://host.test${path}`,
  };
  return { transport, calls };
}

describe('createHttpRedirectsApi', () => {
  it('reads one redirect from its encoded id path and unwraps the data envelope', async () => {
    const { transport, calls } = recordingTransport({ data: { id: 'a/b' } });
    const api = createHttpRedirectsApi({ transport, basePath: '/ws/redirects/' });
    await expect(api.getRedirect({ id: 'a/b' })).resolves.toEqual({ id: 'a/b' });
    expect(calls).toEqual([{ path: '/ws/redirects/a%2Fb', method: 'GET' }]);
  });

  it('lists without a query string when no filter is given', async () => {
    const { transport, calls } = recordingTransport({ data: [] });
    const api = createHttpRedirectsApi({ transport, basePath: '/ws/redirects' });
    await expect(api.listRedirects({})).resolves.toEqual([]);
    expect(calls).toEqual([{ path: '/ws/redirects', method: 'GET' }]);
  });

  it('serialises only the filter keys that were supplied', async () => {
    const { transport, calls } = recordingTransport({ data: [] });
    const api = createHttpRedirectsApi({ transport, basePath: '/ws/redirects' });
    await api.listRedirects({}, { matchType: 'prefix' });
    expect(calls[0]).toEqual({ path: '/ws/redirects?matchType=prefix', method: 'GET' });
  });
});

describe('createMemoryRedirectsApi', () => {
  it('filters by match type', async () => {
    const api = createMemoryRedirectsApi({}, { validate: () => undefined });
    const exact = await api.createRedirect(input);
    await api.createRedirect({ ...input, fromPattern: '/blog', matchType: 'prefix' });
    expect((await api.listRedirects({}, { matchType: 'exact' })).map(row => row.id)).toEqual([exact.id]);
  });

  it('reports a coded validator rejection with INTERNAL_ERROR when the error carries no code', async () => {
    const validate = (rule: AdminRedirectCreateInput) => {
      if (rule.fromPattern === '/bad') throw new AdminApiError({ message: 'pattern rejected', status: 400 });
    };
    const api = createMemoryRedirectsApi({}, { validate });
    const result = await api.importRedirects({ rules: [input, { ...input, fromPattern: '/bad' }] });
    expect(result.created).toHaveLength(1);
    expect(result.failed).toEqual([{ index: 1, code: 'INTERNAL_ERROR', message: 'pattern rejected' }]);
  });

  it('never leaks the message of a non-API failure into an import report', async () => {
    const validate = () => { throw new Error('stack-internal detail'); };
    const api = createMemoryRedirectsApi({}, { validate });
    const result = await api.importRedirects({ rules: [input] });
    expect(result).toEqual({ created: [], failed: [{ index: 0, code: 'INTERNAL_ERROR', message: 'an internal error occurred' }] });
  });
});

describe('redirects controller', () => {
  it('lets a caller set and clear the pending delete directly', async () => {
    const actions = { saving: false, create: vi.fn(), toggle: vi.fn(), remove: vi.fn(), resetOthers: vi.fn() };
    const controller = redirects.createRedirectsController({ actions: () => actions });
    const rule = await realRow();
    const seen: (AdminRedirect | null)[] = [];
    controller.subscribe({ listener: () => seen.push(controller.getSnapshot().pendingDelete) });
    controller.setPendingDelete({ rule });
    expect(controller.getSnapshot().pendingDelete).toBe(rule);
    controller.setPendingDelete({ rule: null });
    expect(controller.getSnapshot().pendingDelete).toBeNull();
    expect(seen).toEqual([rule, null]);
  });
});

describe('redirects public barrel', () => {
  it('exposes the module with its API and events ports wired to the published tokens', () => {
    const { redirectsModule, redirectsApiToken, redirectsEventsToken } = redirects;
    expect(redirectsApiToken).toEqual({ id: 'admin.redirects.api', version: 1, cardinality: 'one' });
    expect(redirectsEventsToken).toEqual({ id: 'admin.redirects.events', version: 1, cardinality: 'one' });
    expect(redirectsModule.id).toBe('redirects');
    expect(redirectsModule.requires.redirectsApi).toBe(redirectsApiToken);
    expect(redirectsModule.optional.redirectsEvents).toBe(redirectsEventsToken);
    expect(redirectsModule.pages.list).toMatchObject({ path: '/redirects', permissions: ['admin.redirects.manage'] });
    expect(redirectsModule.messages).toBe(redirects.redirectsMessagesEn);
    expect(Object.isFrozen(redirectsModule)).toBe(true);
  });

  it('keeps an unmatched placeholder verbatim when its variable is missing', () => {
    expect(redirects.translateRedirectsEn('{created} created, {failed} failed.', { created: 2 }))
      .toBe('2 created, {failed} failed.');
  });

  it('labels row actions with their raw keys when no translator is supplied', async () => {
    const handlers = { onToggleStatus: vi.fn(), onRequestDelete: vi.fn() };
    const rule = await realRow('disabled');
    expect(rule.status).toBe('disabled');
    const items = redirects.redirectRowMenuItems({ rule, handlers });
    expect(items.map(item => item.label)).toEqual(['Enable', 'Delete']);
  });
});
