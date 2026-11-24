import { describe, it, expect } from 'vitest';
import { createHttpOtherCredentials } from '../http.js';
import type { SecurityTransportPort } from '../../ports.js';
import type { RequestOptions } from '../../models.js';
function transport(replies: unknown[]) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const port: SecurityTransportPort = { async request<T>(required: Parameters<SecurityTransportPort['request']>[0], _optional: RequestOptions = {}): Promise<T> { calls.push(required); return replies.shift() as T; } };
  return { port, calls };
}
/** The GET view of the media map. `apiKey` / `apiKeyTail` are view facts a PUT must never echo. */
const MEDIA = {
  a: { apiKeyConfigured: true, apiKeyTail: 'ATAI', apiKey: 'SIBLING_SECRET_A', baseUrl: 'https://a', model: 'a-model' },
  b: { apiKeyConfigured: true, apiKeyTail: 'BTAI', apiKey: 'SIBLING_SECRET_B', baseUrl: 'https://b' },
  c: { model: 'c-model' },
};
type Order = 'in-place' | 'replaced-last';
async function mediaBody({ order, action }: { order?: Order; action: (api: ReturnType<typeof createHttpOtherCredentials>) => Promise<void> }) {
  const t = transport([structuredClone(MEDIA), undefined]);
  await action(createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }, order ? { mediaOrder: order } : {}));
  expect(t.calls[1]).toMatchObject({ path: '/w/media/providers', method: 'PUT' });
  return JSON.stringify(t.calls[1]?.body);
}
describe('createHttpOtherCredentials (SEC-13)', () => {
  it('built-in MCP servers are not listed', async () => {
    const t = transport([{ servers: [{ serverId: 'host-tools', label: 'Renamed host', envNames: [], builtIn: true }, { serverId: 'user-server', label: 'Desktop', envNames: ['TOKEN'], builtIn: false }] }]);
    const rows = await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).list({ store: 'external-mcp' });
    expect(rows.map(row => row.id)).toEqual(['user-server']);
  });
  describe('W12 media whole-map write, byte for byte', () => {
    const replace = (id: string) => (api: ReturnType<typeof createHttpOtherCredentials>) => api.replace({ store: 'media-provider', id, token: 'fixture-token' });
    const remove = (id: string) => (api: ReturnType<typeof createHttpOtherCredentials>) => api.remove({ store: 'media-provider', id });
    it('replaces an existing provider in place by default and appends it last for replaced-last', async () => {
      const inPlace = '{"a":{"baseUrl":"https://a","model":"a-model","apiKey":"fixture-token"},"b":{"baseUrl":"https://b"},"c":{"model":"c-model"}}';
      expect(await mediaBody({ action: replace('a') })).toBe(inPlace);
      expect(await mediaBody({ order: 'in-place', action: replace('a') })).toBe(inPlace);
      expect(await mediaBody({ order: 'replaced-last', action: replace('a') })).toBe('{"b":{"baseUrl":"https://b"},"c":{"model":"c-model"},"a":{"apiKey":"fixture-token","baseUrl":"https://a","model":"a-model"}}');
    });
    it('adds a provider that is not in the map last, in both orders', async () => {
      const added = '{"a":{"baseUrl":"https://a","model":"a-model"},"b":{"baseUrl":"https://b"},"c":{"model":"c-model"},"z":{"apiKey":"fixture-token"}}';
      expect(await mediaBody({ order: 'in-place', action: replace('z') })).toBe(added);
      expect(await mediaBody({ order: 'replaced-last', action: replace('z') })).toBe(added);
    });
    it('drops a removed provider, in both orders', async () => {
      const removed = '{"a":{"baseUrl":"https://a","model":"a-model"},"c":{"model":"c-model"}}';
      expect(await mediaBody({ order: 'in-place', action: remove('b') })).toBe(removed);
      expect(await mediaBody({ order: 'replaced-last', action: remove('b') })).toBe(removed);
    });
    it('echoes siblings as { baseUrl?, model? } only: a sibling apiKey or apiKeyTail never leaves', async () => {
      for (const order of ['in-place', 'replaced-last'] as const) {
        for (const action of [replace('a'), replace('z'), remove('a')]) {
          const body = await mediaBody({ order, action });
          for (const secret of ['SIBLING_SECRET_A', 'SIBLING_SECRET_B', 'ATAI', 'BTAI', 'apiKeyConfigured']) expect(body).not.toContain(secret);
        }
      }
    });
  });
  describe('masked token hints (opt-in, server-approved)', () => {
    const replies = () => [
      { data: { isSet: true, tokenHint: { length: 40, last4: 'ab12' }, apiKey: 'RAW_SECRET', updatedAt: 'd' } },
      { data: { isSet: true, masked: '••••SECRET_SUFFIX', updatedAt: null } },
      { a: { apiKeyConfigured: true, apiKeyTail: 'wxyz', apiKey: 'RAW_MEDIA' }, b: { apiKeyConfigured: true, apiKeyHint: { length: 32, last4: 'h1h1' } } },
      { servers: [{ serverId: 'm', label: 'MCP', envNames: ['A'], accessTokenHint: { length: 20, last4: 'mcp4' }, env: { A: 'RAW_ENV' } }] },
    ];
    async function readAll(options: { tokenHints?: boolean }) {
      const t = transport(replies()); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }, options);
      return [...await api.list({ store: 'site-assistant' }), ...await api.list({ store: 'admin-byok' }), ...await api.list({ store: 'media-provider' }), ...await api.list({ store: 'external-mcp' })];
    }
    it('projects at most the last four characters per row, and no raw secret', async () => {
      const rows = await readAll({ tokenHints: true });
      expect(rows.map(row => row.tokenHint)).toEqual([{ last4: 'ab12', length: 40 }, { last4: 'FFIX' }, { last4: 'wxyz' }, { last4: 'h1h1', length: 32 }, { last4: 'mcp4', length: 20 }]);
      const text = JSON.stringify(rows);
      for (const secret of ['RAW_SECRET', 'SECRET_SUFFIX', 'RAW_MEDIA', 'RAW_ENV']) expect(text).not.toContain(secret);
    });
    it('reads no hint at all unless the host opts in', async () => {
      expect((await readAll({})).some(row => 'tokenHint' in row)).toBe(false);
    });
  });
});
