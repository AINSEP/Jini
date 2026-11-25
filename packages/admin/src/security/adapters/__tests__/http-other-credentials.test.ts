import { describe, it, expect } from 'vitest';
import { createHttpOtherCredentials } from '../http.js';
import type { SecurityTransportPort } from '../../ports.js';
import type { RequestOptions } from '../../models.js';
function transport(replies: unknown[]) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const port: SecurityTransportPort = { async request<T>(required: Parameters<SecurityTransportPort['request']>[0], _optional: RequestOptions = {}): Promise<T> { calls.push(required); return replies.shift() as T; } };
  return { port, calls };
}
type MediaOrder = 'in-place' | 'replaced-last';
/** Every media write option a host can pass; the one-row wire must not depend on any of them. */
const MEDIA_OPTIONS = [{}, { mediaOrder: 'in-place' as MediaOrder }, { mediaOrder: 'replaced-last' as MediaOrder }];
describe('createHttpOtherCredentials (SEC-13)', () => {
  it('built-in MCP servers are not listed', async () => {
    const t = transport([{ servers: [{ serverId: 'host-tools', label: 'Renamed host', envNames: [], builtIn: true }, { serverId: 'user-server', label: 'Desktop', envNames: ['TOKEN'], builtIn: false }] }]);
    const rows = await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).list({ store: 'external-mcp' });
    expect(rows.map(row => row.id)).toEqual(['user-server']);
  });
  describe('media keys go through the one-row routes, never a whole-map rewrite', () => {
    it('Replace sends one PATCH naming only that provider, with only the typed key, in every write order', async () => {
      for (const options of MEDIA_OPTIONS) {
        const t = transport([{ a: { apiKeyConfigured: true } }]);
        await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w/' }, options).replace({ store: 'media-provider', id: 'a', token: 'fixture-token' });
        expect(t.calls).toEqual([{ path: '/w/media/providers/a', method: 'PATCH', body: { apiKey: 'fixture-token' } }]);
      }
    });
    it('Remove sends one DELETE naming only that provider, with no body, in every write order', async () => {
      for (const options of MEDIA_OPTIONS) {
        const t = transport([{}]);
        await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }, options).remove({ store: 'media-provider', id: 'b' });
        expect(t.calls).toEqual([{ path: '/w/media/providers/b', method: 'DELETE' }]);
      }
    });
    it('path-encodes the provider id so it names exactly one row', async () => {
      const t = transport([{}, {}]);
      const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' });
      await api.replace({ store: 'media-provider', id: 'plugin/x y?z', token: 'fixture-token' });
      await api.remove({ store: 'media-provider', id: '../providers' });
      expect(t.calls.map(call => `${call.method} ${call.path}`)).toEqual(['PATCH /w/media/providers/plugin%2Fx%20y%3Fz', 'DELETE /w/media/providers/..%2Fproviders']);
    });
    it('a refused row write is not retried as a read-then-rewrite of the map', async () => {
      const calls: { path: string; method: string }[] = [];
      const refusal = new Error('Someone else changed media providers. Reload and try again.');
      const port: SecurityTransportPort = { async request(required) { calls.push(required); throw refusal; } };
      const api = createHttpOtherCredentials({ transport: port, workspacePath: '/w' });
      await expect(api.replace({ store: 'media-provider', id: 'a', token: 'fixture-token' })).rejects.toBe(refusal);
      await expect(api.remove({ store: 'media-provider', id: 'a' })).rejects.toBe(refusal);
      expect(calls.map(call => call.method)).toEqual(['PATCH', 'DELETE']);
    });
    it('a blank key is refused in plain words before anything is sent', async () => {
      const t = transport([]);
      await expect(createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).replace({ store: 'media-provider', id: 'a', token: '  ' })).rejects.toThrow('Enter a credential');
      expect(t.calls).toEqual([]);
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
