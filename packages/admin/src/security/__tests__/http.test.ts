import { describe, it, expect, vi } from 'vitest';
import { createHttpSecurityApi, createHttpOtherCredentials, createHttpRootKey } from '../adapters/http.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import { ROOT_KEY_PERMISSION } from '../rules.js';
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
  it('leaves sibling media settings untouched through replace and removes only the selected entry', async () => {
    const t = transport([{}, {}]); const api = createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }); await api.replace({ store: 'media-provider', id: 'a', token: 'new-secret' }); await api.remove({ store: 'media-provider', id: 'a' });
    expect(t.calls).toEqual([{ path: '/w/media/providers/a', method: 'PATCH', body: { apiKey: 'new-secret' } }, { path: '/w/media/providers/a', method: 'DELETE' }]);
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
  it('does not dispatch aborted reads or writes', async () => { const t = transport([]); const signal = new AbortController(); signal.abort(); const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' }); await expect(api.custom.list({}, { signal: signal.signal })).rejects.toThrow(signal.signal.reason.message); await expect(api.publish.create({ label: 'x', connection: { token: 'x' } }, { signal: signal.signal })).rejects.toThrow(signal.signal.reason.message); expect(t.calls).toEqual([]); });
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
  it('sends only the typed media key, so stored settings and sibling keys are kept by omission', async () => {
    const t = transport([undefined]);
    await createHttpOtherCredentials({ transport: t.port, workspacePath: '/w' }).replace({ store: 'media-provider', id: 'a', token: 'k' });
    expect(t.calls).toEqual([{ path: '/w/media/providers/a', method: 'PATCH', body: { apiKey: 'k' } }]);
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

// SEC-4 (P10, P11, W14, W16-W18): the host's site-key wire, pinned byte for byte so the SEC-T1 swap
// changes nothing on the wire. Ported from the host's site-key dependencies unit test;
// only the transport fake replaces its stubbed fetch. W15 (reveal) is SEC-6's.
const HOST_WS = '/api/admin/v1/workspaces/workspace-local';
const HOST_KEY = { path: '/system/site-key', importField: 'siteKey' } as const;
const wire = (calls: readonly { method: string; path: string; body?: unknown }[]) => calls.map(c => [c.method, c.path, c.body === undefined ? undefined : JSON.stringify(c.body)]);
describe('SEC-4 root-key wire parity with the host site-key', () => {
  const status = { active: false, state: 'missing', source: 'none', keyFilePath: '/key', runtimeMode: 'local' };
  const generated = { outcome: 'recovered', fingerprint: 'fp-17', keyFilePath: '/key', runtimeMode: 'local' };
  const imported = { outcome: 'unlocked', resealed: 3, fingerprint: 'fp-42', keyFilePath: '/key', runtimeMode: 'local' };
  const preview = { removes: 2, affectedWebhooks: [], detail: 'Two locked credentials', runtimeMode: 'local' };
  const fresh = { outcome: 'started-fresh', discarded: 2, kept: 1, restorePointId: 'rp-17', affectedWebhooks: [], fingerprint: 'fp-83', keyFilePath: '/key', runtimeMode: 'local' };
  it('sends exact host paths, methods and serialized bodies, and returns the literal replies', async () => {
    const t = transport([status, generated, imported, preview, fresh]); const api = createHttpRootKey({ transport: t.port, workspacePath: HOST_WS }, HOST_KEY);
    expect(await api.status({})).toEqual(status); expect(await api.generate({})).toEqual(generated);
    // The pasted value goes out untouched (whitespace included): the host forwards it verbatim and the server decides.
    expect(await api.importToken({ token: '  old-token-42  ' })).toEqual(imported);
    expect(await api.previewStartFresh({})).toEqual(preview); expect(await api.startFresh({ confirm: 'START FRESH' })).toEqual(fresh);
    expect(wire(t.calls)).toEqual([
      ['GET', `${HOST_WS}/system/site-key`, undefined],
      ['POST', `${HOST_WS}/system/site-key/generate`, undefined],
      ['POST', `${HOST_WS}/system/site-key/import`, '{"siteKey":"  old-token-42  "}'],
      ['GET', `${HOST_WS}/system/site-key/start-fresh`, undefined],
      ['POST', `${HOST_WS}/system/site-key/start-fresh`, '{"confirm":"START FRESH"}'],
    ]);
  });
  it('keeps the stock Jini wire when no options are given', async () => {
    const t = transport([status, generated, imported]); const api = createHttpRootKey({ transport: t.port, workspacePath: '/w' });
    await api.status({}); await api.generate({}); await api.importToken({ token: 'old-key' });
    expect(wire(t.calls)).toEqual([['GET', '/w/system/site-token', undefined], ['POST', '/w/system/site-token/generate', undefined], ['POST', '/w/system/site-token/import', '{"token":"old-key"}']]);
  });
  it('sends only the configured import field, never the default one beside it', async () => {
    const t = transport([imported]); await createHttpRootKey({ transport: t.port, workspacePath: '/w' }, { importField: 'siteKey' }).importToken({ token: 'k' });
    expect(wire(t.calls)).toEqual([['POST', '/w/system/site-token/import', '{"siteKey":"k"}']]);
  });
  it('keeps envVarName and reason on status (P10)', async () => {
    const invalid = { active: false, source: 'env', state: 'invalid', keyFilePath: '/key', runtimeMode: 'production', invalid: true, envVarName: 'SITE_KEY_VAR', reason: 'odd-length' };
    const t = transport([invalid]); expect(await createHttpRootKey({ transport: t.port, workspacePath: HOST_WS }, HOST_KEY).status({})).toEqual(invalid);
  });
  it('projects status explicitly: injected hex/token extras never escape, and a present envVarName is kept even when empty', async () => {
    // The host's client preserves a supplied empty string, so presence (not truthiness) decides whether the field is kept.
    const leaky = { ...status, envVarName: '', hex: 'SECRET'.repeat(4), token: 'SECRET', siteKey: 'SECRET', extra: 'SECRET' };
    const t = transport([leaky]); const read = await createHttpRootKey({ transport: t.port, workspacePath: HOST_WS }, HOST_KEY).status({});
    expect(read).toEqual({ ...status, envVarName: '' }); expect(JSON.stringify(read)).not.toContain('SECRET');
  });
  it('omits envVarName from status when the server does not send it', async () => {
    const t = transport([status]); expect(Object.keys(await createHttpRootKey({ transport: t.port, workspacePath: HOST_WS }, HOST_KEY).status({}))).not.toContain('envVarName');
  });
  it('propagates an import refusal unchanged, then permits a retry', async () => {
    // Reject: catch the importToken refusal and return a success-shaped result.
    const refusal = Object.assign(new Error('SITE_KEY_DOES_NOT_OPEN'), { status: 409, body: { error: 'SITE_KEY_DOES_NOT_OPEN', detail: 'Wrong site key' } });
    let attempts = 0; const calls: unknown[] = [];
    const port: SecurityTransportPort = { async request<T>(req: Parameters<SecurityTransportPort['request']>[0]): Promise<T> { calls.push([req.method, req.path, JSON.stringify(req.body)]); if (++attempts === 1) throw refusal; return imported as T; } };
    const api = createHttpRootKey({ transport: port, workspacePath: HOST_WS }, HOST_KEY);
    await expect(api.importToken({ token: 'old-token-42' })).rejects.toBe(refusal);
    await expect(api.importToken({ token: 'old-token-42' })).resolves.toEqual(imported);
    expect(calls).toEqual([0, 1].map(() => ['POST', `${HOST_WS}/system/site-key/import`, '{"siteKey":"old-token-42"}']));
  });
  it('never surfaces a fixture key echoed in a transport refusal: not in the displayed error, state, result or console (P9-SEC §1b)', async () => {
    // Reject: render or log the refusal's message/body; a server that echoes the pasted key must not leak it.
    const FIXTURE_KEY = '0123456789abcdef'.repeat(4);
    const echo = Object.assign(new Error(`SITE_KEY_DOES_NOT_OPEN: ${FIXTURE_KEY}`), { status: 409, body: { error: 'SITE_KEY_DOES_NOT_OPEN', siteKey: FIXTURE_KEY } });
    const locked = { active: false, state: 'mismatch', source: 'file', keyFilePath: '/key', runtimeMode: 'local', siteKey: FIXTURE_KEY };
    const active = { active: true, state: 'active', source: 'file', fingerprint: 'fp-42', keyFilePath: '/key', runtimeMode: 'local', hex: FIXTURE_KEY };
    const replies: (() => unknown)[] = [() => locked, () => { throw echo; }, () => ({ ...imported, siteKey: FIXTURE_KEY }), () => active];
    const calls: string[] = []; const port: SecurityTransportPort = { async request<T>(req: Parameters<SecurityTransportPort['request']>[0]): Promise<T> { calls.push(`${req.method} ${req.path}`); return replies.shift()!() as T; } };
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const c = createRootKeyController({ api: createHttpRootKey({ transport: port, workspacePath: HOST_WS }, HOST_KEY), permissions: [ROOT_KEY_PERMISSION] });
      await c.load({}); c.setToken({ value: FIXTURE_KEY });
      expect(await c.importToken({})).toBe(false);
      const { token, ...refused } = c.getSnapshot(); expect(token).toBe(FIXTURE_KEY); // the operator's own field keeps their input for the retry
      expect(refused.error).toBe('Recovery refused. Check the host key configuration.'); expect(JSON.stringify(refused)).not.toContain(FIXTURE_KEY);
      expect(await c.importToken({})).toBe(true);
      expect(c.getSnapshot()).toMatchObject({ token: '', error: null, result: 'Unlocked. Saved credentials work again. 3 saved since were moved over.', status: { active: true, fingerprint: 'fp-42' } });
      expect(JSON.stringify(c.getSnapshot())).not.toContain(FIXTURE_KEY);
      expect(calls).toEqual([`GET ${HOST_WS}/system/site-key`, `POST ${HOST_WS}/system/site-key/import`, `POST ${HOST_WS}/system/site-key/import`, `GET ${HOST_WS}/system/site-key`]);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls.map(args => args.map(String)))).not.toContain(FIXTURE_KEY);
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
