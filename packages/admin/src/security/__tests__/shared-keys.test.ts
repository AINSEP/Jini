import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { createHttpCredentialCopy, createHttpSecurityApi } from '../adapters/http.js';
import { createMemorySecurityApi } from '../adapters/memory.js';
import { createSharedKeysController, SHARED_KEYS_SOURCE } from '../controllers/shared-keys.controller.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import { credentialCountText, formatTokenHint, sharedKeyRotationWarning } from '../rules.js';
import type { SecurityApiPort, SecurityTransportPort, SharedKeysPort } from '../ports.js';
import type { CredentialSummary } from '../models.js';

const SECRET = 'fixture-secret-value';
const WS = '/workspaces/ws';
type Call = { path: string; method: string; body?: unknown };
function fakeTransport(reply: (call: Call) => unknown) {
  const calls: Call[] = [];
  const transport: SecurityTransportPort = { async request<T>(call: Call) { calls.push(call); return reply(call) as T; } };
  return { transport, calls };
}
/** A server reply carrying secret extras at every level; none may leave the adapter. */
const leakySources = { sources: [{ siteId: SHARED_KEYS_SOURCE, name: 'Shared Keys', secret: SECRET, connection: { token: SECRET },
  keys: [{ kind: 'custom', id: 'k1', label: 'Metrics', provider: 'metrics', worksFor: ['p'], last4: 'ab12', ciphertext: SECRET, connection: { token: SECRET } },
    { kind: 'custom', id: 'k2', label: 'Locked', provider: null, locked: 'Needs its MCP server configuration.', siteName: 'Blog', omittedCount: 3, secret: SECRET }] }] };
const leakyResults = { results: [{ kind: 'custom', id: 'k1', status: 'granted', secret: SECRET, connection: { token: SECRET } }] };
afterEach(() => { vi.restoreAllMocks(); });

describe('Shared Keys wire (W9/W10, SEC-12)', () => {
  it('lists and grants with the exact host bodies and Tovu names', async () => {
    const { transport, calls } = fakeTransport(call => call.method === 'GET' ? leakySources : leakyResults);
    const client = createHttpCredentialCopy({ transport, workspacePath: `${WS}/` });
    const { sources } = await client.listCredentialCopySources({});
    const { results } = await client.copyCredentials({ sourceSiteId: SHARED_KEYS_SOURCE, ids: ['k1'], overwrite: false });
    expect(calls.map(c => [c.method, c.path])).toEqual([['GET', `${WS}/system/credential-copy`], ['POST', `${WS}/system/credential-copy`]]);
    expect(JSON.stringify(calls[1]!.body)).toBe('{"sourceSiteId":"shared-keys","ids":["k1"],"overwrite":false}');
    expect(sources[0]!.keys.map(k => k.id)).toEqual(['k1', 'k2']);
    expect(sources[0]!.keys[0]).toEqual({ kind: 'custom', id: 'k1', label: 'Metrics', provider: 'metrics', worksFor: ['p'], last4: 'ab12' });
    expect(sources[0]!.keys[1]).toEqual({ kind: 'custom', id: 'k2', label: 'Locked', provider: null, locked: 'Needs its MCP server configuration.', siteName: 'Blog', omittedCount: 3 });
    expect(results).toEqual([{ kind: 'custom', id: 'k1', status: 'granted' }]);
    expect(JSON.stringify({ sources, results })).not.toContain(SECRET);
  });
  it('adds sharedKeys and useProjectKey to the security api only when asked, with the W10 body', async () => {
    const { transport, calls } = fakeTransport(call => call.method === 'GET' ? leakySources : call.path.endsWith('/use') ? { keyId: 'a/b', usedByThisSite: true, usedBy: [] } : leakyResults);
    const stock = createHttpSecurityApi({ transport, workspacePath: WS });
    expect(stock.sharedKeys).toBeUndefined(); expect(stock.useProjectKey).toBeUndefined();
    const api = createHttpSecurityApi({ transport, workspacePath: WS }, { sharedKeys: true });
    expect(JSON.stringify(await api.sharedKeys!.list({}))).not.toContain(SECRET);
    expect(await api.sharedKeys!.grant({ sourceSiteId: SHARED_KEYS_SOURCE, ids: ['k1'], overwrite: false })).toEqual([{ kind: 'custom', id: 'k1', status: 'granted' }]);
    await api.useProjectKey!({ keyId: 'a/b', use: true });
    expect(calls.at(-1)).toEqual({ method: 'PUT', path: `${WS}/project-keys/a%2Fb/use`, body: { use: true } });
  });
  it('projects custom storage facts and the masked hint field by field', async () => {
    const credential = { id: 'c1', label: 'Metrics', category: 'ops', baseUrl: 'https://m.example', additionalHosts: [], configured: true, createdAt: 'c', updatedAt: 'u', credentialType: 'custom', worksFor: [],
      scope: 'project', usedBy: ['blog', 'shop'], usedByThisSite: true, tokenHint: { length: 40, last4: 'ab12', raw: SECRET }, token: SECRET };
    const { transport } = fakeTransport(() => ({ credentials: [credential], projectKeysAvailable: true }));
    const snapshot = await createHttpSecurityApi({ transport, workspacePath: WS }).custom.snapshot!({});
    expect(snapshot.projectKeysAvailable).toBe(true);
    expect(snapshot.rows[0]).toMatchObject({ scope: 'project', usedBy: ['blog', 'shop'], usedByThisSite: true, tokenHint: { length: 40, last4: 'ab12' } });
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
  });
});

const sources: AdminCredentialCopySource[] = [{ siteId: SHARED_KEYS_SOURCE, name: 'Shared Keys', keys: [
  { kind: 'custom', id: 'k1', label: 'Metrics', provider: 'metrics', last4: 'ab12' }, { kind: 'custom', id: 'k2', label: 'Locked', provider: null, locked: 'Locked' }] }];
const WRITE = ['security.read', 'custom-credentials.write'];
describe('createSharedKeysController (SEC-12)', () => {
  it('reads metadata once per open, grants one selected key once, and calls onGranted before results show', async () => {
    const port = { list: vi.fn(async () => sources), grant: vi.fn(async () => [{ kind: 'custom', id: 'k1', status: 'granted' as const }]) };
    const seen: number[] = [];
    const controller = createSharedKeysController({ port, permissions: WRITE }, { onGranted: () => { seen.push(controller.getSnapshot().results.length); } });
    await controller.open({});
    expect(port.list).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().source?.keys).toHaveLength(2);
    controller.select({ id: 'k2' }); expect(await controller.grant({})).toBe(false);
    controller.select({ id: 'k1' });
    const [first, second] = await Promise.all([controller.grant({}), controller.grant({})]);
    expect([first, second]).toEqual([true, false]);
    expect(port.grant).toHaveBeenCalledTimes(1);
    expect(port.grant).toHaveBeenCalledWith({ sourceSiteId: 'shared-keys', ids: ['k1'], overwrite: false }, expect.anything());
    expect(seen).toEqual([0]); expect(controller.getSnapshot().results).toHaveLength(1);
  });
  it('sends nothing without the custom write grant and reports fixed failures without secrets', async () => {
    const log = vi.spyOn(console, 'error'); const warn = vi.spyOn(console, 'warn');
    const denied = createSharedKeysController({ port: { list: vi.fn(async () => sources), grant: vi.fn() }, permissions: ['security.read'] });
    await denied.open({}); expect(denied.getSnapshot().open).toBe(false);
    const port = { list: vi.fn<SharedKeysPort['list']>(async () => { throw new Error(SECRET); }), grant: vi.fn<SharedKeysPort['grant']>(async () => { throw new Error(SECRET); }) };
    const controller = createSharedKeysController({ port, permissions: WRITE });
    await controller.open({}); expect(controller.getSnapshot().failure).toBe('load');
    port.list.mockResolvedValueOnce(sources); await controller.open({}); controller.select({ id: 'k1' }); await controller.grant({});
    expect(controller.getSnapshot().failure).toBe('grant');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(SECRET);
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(SECRET);
  });
});

const projectRow: CredentialSummary = { kind: 'custom', id: 'p1', providerId: '', label: 'Metrics', configured: true, isDefault: false, createdAt: 'c', updatedAt: 'u', category: 'ops', baseUrl: 'https://m.example', scope: 'project', usedBy: ['blog'], usedByThisSite: false };
describe('project-key use and storage choice (SEC-12)', () => {
  it('attaches a project key once per double click, refetches, and keeps a failure on its row', async () => {
    const api = createMemorySecurityApi({ rows: [projectRow], projectKeysAvailable: true });
    const use = vi.spyOn(api as Required<SecurityApiPort>, 'useProjectKey');
    const controller = createAccessTokensController({ api, permissions: WRITE }); await controller.load({});
    const [a, b] = await Promise.all([controller.attachKey({ row: projectRow, use: true }), controller.attachKey({ row: projectRow, use: true })]);
    expect([a, b]).toEqual([true, false]); expect(use).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().rows[0]).toMatchObject({ usedByThisSite: true });
    use.mockRejectedValueOnce(new Error(SECRET));
    expect(await controller.attachKey({ row: projectRow, use: false })).toBe(false);
    expect(controller.getSnapshot().keyUse.p1).toEqual({ saving: false, failed: true });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(SECRET);
  });
  it('saves a new custom key to the project only when the server offers project keys', async () => {
    for (const [available, scope] of [[true, 'project'], [false, 'site']] as const) {
      const api = createMemorySecurityApi({ projectKeysAvailable: available }); const create = vi.spyOn(api.custom, 'create');
      const controller = createAccessTokensController({ api, permissions: WRITE }); await controller.load({});
      controller.begin({ kind: 'custom' }); controller.setDraft({ patch: { label: 'Metrics', token: 'fixture-token', baseUrl: 'https://m.example' } });
      await controller.save({});
      expect(create.mock.calls[0]![0]).toMatchObject({ scope });
    }
  });
});

describe('hint, rotation and count copy (SEC-9/SEC-12 rules)', () => {
  it('shows the masked hint exactly as sent', () => {
    expect(formatTokenHint({ hint: { length: 40, last4: 'ab12' } })).toBe('…ab12, 40 chars');
    expect(formatTokenHint({ hint: { length: 7, last4: null } })).toBe('7 chars');
    expect(formatTokenHint({ hint: null })).toBe('');
  });
  it('warns only when another site uses a project key', () => {
    expect(sharedKeyRotationWarning({ row: { scope: 'project', usedBy: ['a', 'b'], usedByThisSite: true } })).toBe('Used by 1 other site; it will use the new token too.');
    expect(sharedKeyRotationWarning({ row: { scope: 'project', usedBy: ['a', 'b', 'c'], usedByThisSite: false } })).toBe('Used by 3 other sites; they will use the new token too.');
    expect(sharedKeyRotationWarning({ row: { scope: 'project', usedBy: ['a'], usedByThisSite: true } })).toBeNull();
    expect(sharedKeyRotationWarning({ row: { scope: 'site', usedBy: ['a', 'b'] } })).toBeNull();
  });
  it('builds the count sentence from translator keys and variables', () => {
    const t = (key: string, vars: Record<string, string | number> = {}) => `${key}:${JSON.stringify(vars)}`;
    expect(credentialCountText({ total: 1, matched: 1, query: '' }, { t })).toBe('tokenCountOne:{"count":1}');
    expect(credentialCountText({ total: 3, matched: 0, query: 'x' }, { t })).toBe('tokenCountMatchingMany:{"matched":0,"count":3,"query":"x"}');
  });
});
