import { describe, it, expect } from 'vitest';
import { createHttpSecurityApi, createHttpOtherCredentials, createHttpRootKey } from '../adapters/http.js';
import type { SecurityTransportPort } from '../ports.js';
function transport(replies: unknown[]) {
  const calls: { path: string; method: string; body?: unknown }[] = []; const signals: (AbortSignal | undefined)[] = [];
  const port: SecurityTransportPort = { async request<T>(required: Parameters<SecurityTransportPort['request']>[0], optional: import('../models.js').RequestOptions = {}): Promise<T> { calls.push(required); signals.push(optional.signal); return replies.shift() as T; } };
  return { port, calls, signals };
}
const raw = { id: 'a/b', providerId: 'git', label: 'Personal', configured: true, isDefault: true, createdAt: 'date', updatedAt: 'date', token: 'SHOULD_NOT_ESCAPE' };
describe('security HTTP wire contract', () => {
  it('matches credential routes, envelopes, encoding, metadata-only writes and signal', async () => {
    const t = transport([{ credentials: [raw] }, { credential: raw }, { credential: raw }, undefined]); const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/api/admin/v1/workspaces/w/' }); const signal = new AbortController().signal;
    expect(JSON.stringify(await api.sourceControl.list({}, { signal }))).not.toContain('SHOULD_NOT_ESCAPE'); await api.sourceControl.create({ label: 'Personal', connection: { providerId: 'git', token: 'new' } }); await api.sourceControl.update({ id: 'a/b', patch: { label: 'Renamed' } }); await api.sourceControl.remove({ id: 'a/b' });
    expect(t.calls).toEqual([{ path: '/api/admin/v1/workspaces/w/system/source-control/credentials', method: 'GET' }, { path: '/api/admin/v1/workspaces/w/system/source-control/credentials', method: 'POST', body: { label: 'Personal', connection: { providerId: 'git', token: 'new' } } }, { path: '/api/admin/v1/workspaces/w/system/source-control/credentials/a%2Fb', method: 'PUT', body: { label: 'Renamed' } }, { path: '/api/admin/v1/workspaces/w/system/source-control/credentials/a%2Fb', method: 'DELETE' }]); expect(t.signals[0]).toBe(signal);
  });
  it('reads descriptors without conflating publish targets with source identities', async () => {
    const t = transport([{ targets: [{ id: 'git-pages', label: 'Git Pages', credential: { vendorLabel: 'Git vendor', tokenField: 'apiToken', fields: [{ name: 'account', label: 'Account', required: true }], userHelp: 'Human guidance' } }] }, { providers: [{ id: 'git', label: 'Git' }] }]);
    const rows = await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({}); expect(rows.map(r => [r.kind, r.id, r.tokenField])).toEqual([['publish', 'git-pages', 'apiToken'], ['source-control', 'git', 'token']]);
    expect(t.calls.map(c => c.path)).toEqual(['/w/system/publish-targets', '/w/system/source-control/providers']);
  });
  it('preserves sibling media settings through replace and removes only the selected entry', async () => {
    const current = { a: { apiKeyConfigured: true, apiKeyTail: 'tail', baseUrl: 'https://a', model: 'a-model' }, b: { apiKeyConfigured: true, baseUrl: 'https://b', model: 'b-model' } };
    const t = transport([current, {}, current, {}]); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }); await api.replace({ store: 'media-provider', id: 'a', token: 'new-secret' }); await api.remove({ store: 'media-provider', id: 'a' });
    expect(t.calls[1]).toEqual({ path: '/w/media/providers', method: 'PUT', body: { a: { apiKey: 'new-secret', baseUrl: 'https://a', model: 'a-model' }, b: { baseUrl: 'https://b', model: 'b-model' } } }); expect(t.calls[3]?.body).toEqual({ b: { baseUrl: 'https://b', model: 'b-model' } });
  });
  it('reads other stores without exposing masked tails or secret extras, and refuses single-field MCP replacement', async () => {
    const t = transport([{ data: { isSet: true, masked: 'SECRET_SUFFIX', apiKey: 'RAW', updatedAt: 'd' } }, { servers: [{ serverId: 'm/c', label: 'MCP', envNames: ['KEY'], env: { KEY: 'SECRET' } }] }, undefined]); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' });
    expect(JSON.stringify(await api.list({ store: 'site-assistant' }))).not.toContain('SECRET_SUFFIX'); expect(await api.list({ store: 'external-mcp' })).toEqual([{ store: 'external-mcp', id: 'm/c', label: 'MCP', category: 'ai', configured: true, supportsReplace: false, envNames: ['KEY'] }]); await api.remove({ store: 'external-mcp', id: 'm/c' }); expect(t.calls[2]?.path).toBe('/w/mcp-servers/m%2Fc'); await expect(api.replace({ store: 'external-mcp', id: 'm/c', token: 'x' })).rejects.toThrow('full server configuration'); expect(t.calls).toHaveLength(3);
  });
  it('matches root-key status/generate/import/preview/start-fresh without exposing raw values', async () => {
    const status = { active: false, source: 'none', state: 'missing', keyFilePath: '/key', runtimeMode: 'local', hex: 'SECRET' }; const result = { outcome: 'created', fingerprint: 'fp', keyFilePath: '/key', runtimeMode: 'local', hex: 'SECRET' }; const preview = { removes: 1, affectedWebhooks: [], detail: 'One credential removed', runtimeMode: 'local' };
    const t = transport([status, result, result, preview, result]); const api = createHttpRootKey({ transport: t.port, workspacePath: '/w' }); expect(JSON.stringify(await api.status({}))).not.toContain('SECRET'); expect(JSON.stringify(await api.generate({}))).not.toContain('SECRET'); await api.importToken({ token: 'old-key' }); await api.previewStartFresh({}); await api.startFresh({ confirm: 'START FRESH' });
    expect(t.calls.map(c => [c.method, c.path, c.body])).toEqual([['GET', '/w/system/site-token', undefined], ['POST', '/w/system/site-token/generate', undefined], ['POST', '/w/system/site-token/import', { token: 'old-key' }], ['GET', '/w/system/site-token/start-fresh', undefined], ['POST', '/w/system/site-token/start-fresh', { confirm: 'START FRESH' }]]);
  });
  it('does not dispatch aborted reads or writes', async () => { const t = transport([]); const signal = new AbortController(); signal.abort(); const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }); await expect(api.custom.list({}, { signal: signal.signal })).rejects.toThrow(); await expect(api.publish.create({ label: 'x', connection: { token: 'x' } }, { signal: signal.signal })).rejects.toThrow(); expect(t.calls).toEqual([]); });
});
