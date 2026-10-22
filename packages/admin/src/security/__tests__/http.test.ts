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
describe('security HTTP projections and routing boundaries', () => {
  const aborted = () => { const c = new AbortController(); c.abort(); return c.signal; };
  it('projects a custom row with defaults and drops a blank username', async () => {
    const t = transport([{ credentials: [{ id: 'c', label: 'C', configured: true, createdAt: 'd', updatedAt: 'e', username: '' }] }]);
    expect(await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).custom.list({})).toEqual([{ kind: 'custom', id: 'c', providerId: '', label: 'C', configured: true, isDefault: false, createdAt: 'd', updatedAt: 'e', category: 'general', baseUrl: '', additionalHosts: [] }]);
  });
  it('projects a custom row with its stored metadata and account label', async () => {
    const t = transport([{ credential: { id: 'c', providerId: '', label: 'C', configured: true, isDefault: false, createdAt: 'd', updatedAt: 'e', accountLabel: null, category: 'ai', baseUrl: 'https://a', additionalHosts: ['https://b'], username: 'me', token: 'SHOULD_NOT_ESCAPE' } }]);
    expect(await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).custom.create({ label: 'C', connection: { token: 'x' } })).toEqual({ kind: 'custom', id: 'c', providerId: '', label: 'C', configured: true, isDefault: false, createdAt: 'd', updatedAt: 'e', accountLabel: null, category: 'ai', baseUrl: 'https://a', additionalHosts: ['https://b'], username: 'me' });
  });
  it('never adds custom metadata to a publish row', async () => {
    const t = transport([{ credential: { ...raw, category: 'ai', baseUrl: 'https://a', username: 'me' } }]);
    expect(await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).publish.update({ id: 'a/b', patch: {} })).toEqual({ kind: 'publish', id: 'a/b', providerId: 'git', label: 'Personal', configured: true, isDefault: true, createdAt: 'date', updatedAt: 'date' });
    expect(t.calls[0]?.path).toBe('/w/system/publish/credentials/a%2Fb');
  });
  it('does not dispatch an aborted update or remove', async () => {
    const t = transport([]); const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' });
    await expect(api.custom.update({ id: 'x', patch: {} }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
    await expect(api.custom.remove({ id: 'x' }, { signal: aborted() })).rejects.toThrow('This operation was aborted'); expect(t.calls).toEqual([]);
  });
  it('does not dispatch an aborted provider read', async () => { const t = transport([]); await expect(createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({}, { signal: aborted() })).rejects.toThrow('This operation was aborted'); expect(t.calls).toEqual([]); });
  it('skips publish targets without a credential and fills descriptor defaults', async () => {
    const t = transport([{ targets: [{ id: 'static', label: 'Static' }, { id: 'pages', label: 'Pages', credential: { tokenField: 'key' } }] }, { providers: [] }]);
    expect(await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({})).toEqual([{ kind: 'publish', id: 'pages', label: 'Pages', vendorLabel: 'Pages', category: 'hosting', tokenField: 'key', fields: [] }]);
  });
  it('maps descriptor links and falls back to plain help without user help', async () => {
    const t = transport([{ targets: [] }, { providers: [{ id: 'git', label: 'Git', credential: { tokenField: 'token', tokenPageUrl: 'https://tokens', help: 'Plain help' } }] }]);
    expect(await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({})).toEqual([{ kind: 'source-control', id: 'git', label: 'Git', vendorLabel: 'Git', category: 'source-control', tokenField: 'token', fields: [], tokenPageUrl: 'https://tokens', help: 'Plain help' }]);
  });
  it('labels a provider by its descriptor vendor label', async () => {
    const t = transport([{ targets: [{ id: 'pages', label: 'Pages', credential: { tokenField: 'token', vendorLabel: 'Vendor' } }] }, { providers: [] }]);
    expect((await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({}))[0]?.vendorLabel).toBe('Vendor');
  });
  it('prefers user help over plain help', async () => {
    const t = transport([{ targets: [] }, { providers: [{ id: 'git', label: 'Git', credential: { tokenField: 'token', help: 'Plain', userHelp: 'User' } }] }]);
    expect((await createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }).providers({}))[0]?.help).toBe('User');
  });
  it('lists a set single store with its label, and an unset one as empty', async () => {
    const t = transport([{ data: { isSet: true, updatedAt: null } }, { data: { isSet: false, updatedAt: null } }]); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w/' });
    expect(await api.list({ store: 'admin-byok' })).toEqual([{ store: 'admin-byok', id: 'admin-byok', label: 'Admin model key', category: 'ai', configured: true, supportsReplace: true, updatedAt: null }]);
    expect(await api.list({ store: 'site-assistant' })).toEqual([]); expect(t.calls.map(c => c.path)).toEqual(['/w/assistant/execution-credential', '/w/assistant/site-credential']);
  });
  it('lists only configured media providers, labelled by host labels or id', async () => {
    const t = transport([{ a: { apiKeyConfigured: true }, b: { apiKeyConfigured: false }, c: { apiKeyConfigured: true } }]);
    expect(await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }, { mediaLabels: { a: 'Alpha' } }).list({ store: 'media-provider' })).toEqual([{ store: 'media-provider', id: 'a', label: 'Alpha', category: 'media', configured: true, supportsReplace: true }, { store: 'media-provider', id: 'c', label: 'c', category: 'media', configured: true, supportsReplace: true }]);
  });
  it('refuses a blank replacement before any request', async () => { const t = transport([]); await expect(createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).replace({ store: 'external-mcp', id: 'm', token: '  ' })).rejects.toThrow(/^Enter a credential$/); expect(t.calls).toEqual([]); });
  it('replaces and removes a single store key at its own path', async () => {
    const t = transport([undefined, undefined]); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' });
    await api.replace({ store: 'site-assistant', id: 'site-assistant', token: 'k' }); await api.remove({ store: 'admin-byok', id: 'admin-byok' });
    expect(t.calls).toEqual([{ path: '/w/assistant/site-credential', method: 'PUT', body: { apiKey: 'k' } }, { path: '/w/assistant/execution-credential', method: 'DELETE' }]);
  });
  it('rebuilds media entries without absent settings, and keeps a stored key by omission', async () => {
    const t = transport([{ a: { apiKeyConfigured: true }, b: { apiKeyConfigured: true, apiKey: 'STORED', apiKeyTail: 'tail' } }, undefined]);
    await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).replace({ store: 'media-provider', id: 'a', token: 'k' });
    expect(t.calls[1]?.body).toEqual({ a: { apiKey: 'k' }, b: {} });
  });
  it('does not dispatch an aborted other-store read', async () => { const t = transport([]); await expect(createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).list({ store: 'external-mcp' }, { signal: aborted() })).rejects.toThrow('This operation was aborted'); expect(t.calls).toEqual([]); });
  it('projects optional root-key status and result fields', async () => {
    const status = { active: true, source: 'file', state: 'active', keyFilePath: '/k', runtimeMode: 'production', fingerprint: 'fp', invalid: false };
    const result = { outcome: 'started-fresh', fingerprint: 'fp', keyFilePath: '/k', runtimeMode: 'local', resealed: 0, discarded: 2, kept: 0, restorePointId: 'rp', affectedWebhooks: [{ label: 'Hook', targetUrl: 'https://h', secret: 'SECRET' }] };
    const t = transport([status, result]); const api = createHttpRootKey({ transport: t.port, workspacePath: '/w/' });
    expect(await api.status({})).toEqual(status); expect(await api.startFresh({ confirm: 'START FRESH' })).toEqual({ ...result, affectedWebhooks: [{ label: 'Hook', targetUrl: 'https://h' }] });
  });
  it('omits an empty restore point and keeps an empty webhook list', async () => {
    const t = transport([{ outcome: 'x', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local', restorePointId: '', affectedWebhooks: [] }]);
    expect(await createHttpRootKey({ transport: t.port, workspacePath: '/w' }).generate({})).toEqual({ outcome: 'x', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local', affectedWebhooks: [] });
  });
  it('omits an empty fingerprint from status', async () => { const t = transport([{ active: false, source: 'none', state: 'missing', keyFilePath: '/k', runtimeMode: 'local', fingerprint: '' }]); expect(await createHttpRootKey({ transport: t.port, workspacePath: '/w' }).status({})).toEqual({ active: false, source: 'none', state: 'missing', keyFilePath: '/k', runtimeMode: 'local' }); });
  it('strips webhook extras from a start-fresh preview', async () => { const t = transport([{ removes: 1, detail: 'd', runtimeMode: 'local', affectedWebhooks: [{ label: 'H', targetUrl: 'https://h', secret: 'SECRET' }], extra: 'SECRET' }]); expect(await createHttpRootKey({ transport: t.port, workspacePath: '/w' }).previewStartFresh({})).toEqual({ removes: 1, detail: 'd', runtimeMode: 'local', affectedWebhooks: [{ label: 'H', targetUrl: 'https://h' }] }); });
  it('does not dispatch an aborted root-key request', async () => { const t = transport([]); await expect(createHttpRootKey({ transport: t.port, workspacePath: '/w' }).importToken({ token: 'x' }, { signal: aborted() })).rejects.toThrow('This operation was aborted'); expect(t.calls).toEqual([]); });
});
