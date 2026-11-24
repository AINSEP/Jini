import { describe, it, expect, vi } from 'vitest';
import { blankCredentialDraft, buildCredentialPatch, validateCredentialDraft } from '../rules.js';
import { fieldsAroundToken, invalidAdditionalHosts, worksForChanged, worksForChoices } from '../credential-forms.rules.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import { createMemorySecurityApi } from '../adapters/memory.js';
import { createHttpCustomCredentials } from '../adapters/http.js';
import type { CredentialDraft, CredentialProvider, CredentialSummary } from '../models.js';
import type { SecurityTransportPort } from '../ports.js';

const TOKEN = 'fixture-token';
const deploy: CredentialProvider = { kind: 'publish', id: 'deployer', label: 'Deployer', vendorLabel: 'Deploy vendor', category: 'hosting', tokenField: 'secretKey',
  fields: [{ name: 'accessKeyId', label: 'Access key ID', required: true }, { name: 'secretKey', label: 'Secret key', secret: true }, { name: 'region', label: 'Region' }] };
const git: CredentialProvider = { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] };
const providers = [deploy, git];
const ALL = ['security.read', 'system.publish', 'source-control.credentials.write', 'custom-credentials.write'];
const row = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'publish', id: 'p1', providerId: 'deployer', label: 'Work', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd', ...over });
const edit = (over: Partial<CredentialDraft>): CredentialDraft => ({ ...blankCredentialDraft({ kind: 'publish', providerId: 'deployer' }), id: 'p1', label: 'Work', ...over });
const customDraft = (over: Partial<CredentialDraft>): CredentialDraft => ({ ...blankCredentialDraft({ kind: 'custom' }), label: 'Metrics', token: TOKEN, baseUrl: 'https://api.metrics.test', ...over });

describe('SEC-10 vendor write bodies (W2/W3)', () => {
  const saved = { label: 'Work' };
  it('a rename without a token sends { label } only, with no connection key', () => {
    expect(buildCredentialPatch({ draft: edit({ label: ' Renamed ' }), providers }, { saved })).toEqual({ label: 'Renamed' });
  });
  it('an unchanged edit sends nothing', () => { expect(buildCredentialPatch({ draft: edit({}), providers }, { saved })).toEqual({}); });
  it('a token replace puts the extra fields inside connection, never at the top level', () => {
    expect(buildCredentialPatch({ draft: edit({ token: TOKEN, values: { accessKeyId: 'AK', region: 'eu' } }), providers }, { saved }))
      .toEqual({ connection: { providerId: 'deployer', secretKey: TOKEN, accessKeyId: 'AK', region: 'eu' } });
  });
  it('worksFor is sent only when its membership changed; [] clears it', () => {
    expect(buildCredentialPatch({ draft: edit({ worksFor: ['b', 'a'] }), providers }, { saved: { ...saved, worksFor: ['a', 'b'] } })).toEqual({});
    expect(buildCredentialPatch({ draft: edit({ worksFor: ['a', 'c'] }), providers }, { saved: { ...saved, worksFor: ['a', 'b'] } })).toEqual({ worksFor: ['a', 'c'] });
    expect(buildCredentialPatch({ draft: edit({ worksFor: [] }), providers }, { saved: { ...saved, worksFor: ['a'] } })).toEqual({ worksFor: [] });
  });
  it('source control never sends worksFor', () => {
    const draft = { ...blankCredentialDraft({ kind: 'source-control', providerId: 'git' }), id: 's1', label: 'Work', worksFor: ['x'] };
    expect(buildCredentialPatch({ draft, providers }, { saved })).toEqual({});
  });
  it('a create sends label and connection, plus worksFor only when chosen', () => {
    const draft = { ...blankCredentialDraft({ kind: 'publish', providerId: 'deployer' }), label: 'New', token: TOKEN, values: { accessKeyId: 'AK' } };
    expect(buildCredentialPatch({ draft, providers })).toEqual({ label: 'New', connection: { providerId: 'deployer', secretKey: TOKEN, accessKeyId: 'AK' } });
    expect(buildCredentialPatch({ draft: { ...draft, worksFor: ['site-a'] }, providers })).toEqual({ label: 'New', worksFor: ['site-a'], connection: { providerId: 'deployer', secretKey: TOKEN, accessKeyId: 'AK' } });
  });
  it('worksForChanged treats omission as unchanged', () => {
    expect(worksForChanged({ saved: ['a'] })).toBe(false); expect(worksForChanged({ draft: ['a'], saved: ['a'] })).toBe(false); expect(worksForChanged({ draft: ['a'] })).toBe(true);
  });
});

describe('SEC-10 vendor form shape', () => {
  it('splits the extra fields around the token in the declared order', () => {
    const { before, after } = fieldsAroundToken({ provider: deploy });
    expect(before.map(f => f.name)).toEqual(['accessKeyId']); expect(after.map(f => f.name)).toEqual(['region']);
    expect(fieldsAroundToken({ provider: { ...deploy, tokenField: 'missing' } }).after.map(f => f.name)).toEqual(['accessKeyId', 'secretKey', 'region']);
  });
  it('keeps a saved worksFor id whose plugin is disabled as its own chip', () => {
    expect(worksForChoices({ providers, value: ['gone-plugin', 'deployer'] })).toEqual([
      { value: 'deployer', label: 'Deployer' }, { value: 'git', label: 'Git host' }, { value: 'gone-plugin', label: 'gone-plugin' }]);
  });
});

describe('SEC-10 controller: edits and denied grants', () => {
  it('opens an edit draft with the saved worksFor and sends no write for an unchanged edit', async () => {
    const api = createMemorySecurityApi({ providers, rows: [row({ worksFor: ['site-a'] })] }); const update = vi.spyOn(api.publish, 'update');
    const c = createAccessTokensController({ api, permissions: ALL }); await c.load({});
    c.begin({ row: c.getSnapshot().rows[0]! }); expect(c.getSnapshot().draft?.worksFor).toEqual(['site-a']);
    expect(await c.save({})).toBe(false); expect(update).not.toHaveBeenCalled();
    c.setDraft({ patch: { worksFor: [] } }); expect(await c.save({})).toBe(true);
    expect(update).toHaveBeenCalledWith({ id: 'p1', patch: { worksFor: [] } }, expect.anything());
  });
  it.each([
    ['publish', row({})],
    ['source-control', row({ kind: 'source-control', id: 's1', providerId: 'git' })],
    ['custom', row({ kind: 'custom', id: 'c1', providerId: '' })],
  ] as const)('refuses every %s write without its write grant', async (_kind, saved) => {
    const api = createMemorySecurityApi({ providers, rows: [saved] }); const c = createAccessTokensController({ api, permissions: ['security.read'] }); await c.load({});
    const store = saved.kind === 'publish' ? api.publish : saved.kind === 'custom' ? api.custom : api.sourceControl;
    const remove = vi.spyOn(store, 'remove'), update = vi.spyOn(store, 'update');
    c.begin({ row: c.getSnapshot().rows[0]! }); expect(c.getSnapshot().draft).toBeNull();
    expect(await c.remove({ row: saved })).toBe(false); expect(await c.makeDefault({ row: saved })).toBe(false);
    expect(remove).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
});

describe('SEC-11 custom bodies (W8)', () => {
  it('a create sends no top-level username and omits empty additional hosts', () => {
    expect(buildCredentialPatch({ draft: customDraft({ username: ' bot ' }), providers: [] }))
      .toEqual({ label: 'Metrics', category: 'general', baseUrl: 'https://api.metrics.test', connection: { token: TOKEN, username: 'bot' } });
    expect(buildCredentialPatch({ draft: customDraft({ additionalHosts: 'https://a.test,\n https://b.test', worksFor: ['p'] }), providers: [] }))
      .toEqual({ label: 'Metrics', worksFor: ['p'], category: 'general', baseUrl: 'https://api.metrics.test', additionalHosts: ['https://a.test', 'https://b.test'], connection: { token: TOKEN } });
  });
  it('an update sends only the changed fields, null to clear a username', () => {
    const saved = { label: 'Metrics', username: 'bot', category: 'general' as const, baseUrl: 'https://api.metrics.test', additionalHosts: ['https://a.test'] };
    const base = customDraft({ id: 'c1', token: '', username: 'bot', additionalHosts: 'https://a.test' });
    expect(buildCredentialPatch({ draft: base, providers: [] }, { saved })).toEqual({});
    expect(buildCredentialPatch({ draft: { ...base, label: 'Renamed' }, providers: [] }, { saved })).toEqual({ label: 'Renamed' });
    expect(buildCredentialPatch({ draft: { ...base, username: ' ' }, providers: [] }, { saved })).toEqual({ username: null });
    expect(buildCredentialPatch({ draft: { ...base, username: 'robot' }, providers: [] }, { saved })).toEqual({ username: 'robot' });
    expect(buildCredentialPatch({ draft: { ...base, additionalHosts: '' }, providers: [] }, { saved })).toEqual({ additionalHosts: [] });
    expect(buildCredentialPatch({ draft: { ...base, category: 'ai', baseUrl: 'https://v2.metrics.test' }, providers: [] }, { saved })).toEqual({ category: 'ai', baseUrl: 'https://v2.metrics.test' });
  });
  it('validates every additional host as its own http(s) origin', () => {
    expect(invalidAdditionalHosts({ raw: 'https://ok.test, cdn.metrics.test\nftp://x.test' })).toEqual(['cdn.metrics.test', 'ftp://x.test']);
    expect(validateCredentialDraft({ draft: customDraft({ additionalHosts: 'cdn.metrics.test' }), rows: [], providers: [] })).toBe('Each additional host must be a valid http:// or https:// URL.');
    expect(validateCredentialDraft({ draft: customDraft({ additionalHosts: 'https://cdn.metrics.test' }), rows: [], providers: [] })).toBeNull();
    expect(validateCredentialDraft({ draft: customDraft({ baseUrl: 'javascript:alert(1)' }), rows: [], providers: [] })).toBe('Enter an HTTP or HTTPS URL');
  });
  it.each([[true, { scope: 'project' }], [false, { scope: 'site' }], [undefined, {}]] as const)('a create with projectKeysAvailable=%s sends %o', async (available, scope) => {
    const api = createMemorySecurityApi({ ...(available === undefined ? {} : { projectKeysAvailable: available }) }); const create = vi.spyOn(api.custom, 'create');
    const c = createAccessTokensController({ api, permissions: ALL }); await c.load({});
    c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Metrics', token: TOKEN, baseUrl: 'https://api.metrics.test' } });
    expect(await c.save({})).toBe(true);
    expect(create.mock.calls[0]![0]).toEqual({ ...scope, label: 'Metrics', category: 'general', baseUrl: 'https://api.metrics.test', connection: { token: TOKEN } });
  });
  it('keeps the submitted secret out of snapshots, failure text and the console', async () => {
    const api = createMemorySecurityApi({}); vi.spyOn(api.custom, 'create').mockRejectedValue(new Error(`rejected ${TOKEN}`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = createAccessTokensController({ api, permissions: ALL }); await c.load({});
    c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Metrics', token: TOKEN, baseUrl: 'https://api.metrics.test', username: 'bot' } });
    expect(await c.save({})).toBe(false);
    expect(c.getSnapshot().error).not.toContain(TOKEN);
    expect(JSON.stringify({ ...c.getSnapshot(), draft: null })).not.toContain(TOKEN);
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(TOKEN);
    log.mockRestore(); warn.mockRestore();
  });
});

describe('SEC-11 createHttpCustomCredentials (host-facing names)', () => {
  function transport(replies: unknown[]) {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const port: SecurityTransportPort = { async request<T>(required: Parameters<SecurityTransportPort['request']>[0]): Promise<T> { calls.push(required); return replies.shift() as T; } };
    return { port, calls };
  }
  const BASE = '/workspaces/w1/system/custom/credentials';
  it('lists, creates, updates and deletes with the exact host bodies', async () => {
    const t = transport([{ credentials: [], projectKeysAvailable: true }, { credential: {} }, { credential: {} }, { credential: {} }, undefined]);
    const client = createHttpCustomCredentials({ transport: t.port, workspacePath: '/workspaces/w1/' });
    expect(await client.listCustomCredentials()).toEqual({ credentials: [], projectKeysAvailable: true });
    await client.createCustomCredential({ label: 'Example Host', category: 'hosting', baseUrl: 'https://api.example-host.test', connection: { token: TOKEN } });
    await client.updateCustomCredential({ id: 'cc/1', input: { label: 'Renamed' } });
    await client.updateCustomCredential({ id: 'cc-1', input: { username: null } });
    await client.deleteCustomCredential({ id: 'cc-1' });
    expect(t.calls).toEqual([
      { method: 'GET', path: BASE },
      { method: 'POST', path: BASE, body: { label: 'Example Host', category: 'hosting', baseUrl: 'https://api.example-host.test', connection: { token: TOKEN } } },
      { method: 'PUT', path: `${BASE}/cc%2F1`, body: { label: 'Renamed' } },
      { method: 'PUT', path: `${BASE}/cc-1`, body: { username: null } },
      { method: 'DELETE', path: `${BASE}/cc-1` },
    ]);
  });
});
