import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHttpPublishCredentials, createHttpSecurityApi } from '../adapters/http.js';
import { createMemoryPublishCredentials, createMemorySecurityApi } from '../adapters/memory.js';
import { runPublishCredentialsConformance } from '../conformance/security-api.conformance.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import type { SecurityTransportPort } from '../ports.js';
import type { CredentialProvider } from '../models.js';

const SECRET = 'fixture-token';
const W = '/api/admin/v1/workspaces/w';
function transport(replies: unknown[]) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const port: SecurityTransportPort = { async request<T>(required: Parameters<SecurityTransportPort['request']>[0]): Promise<T> { calls.push(required); return replies.shift() as T; } };
  return { port, calls };
}
const raw = { id: 'a/b', providerId: 'cdn', label: 'Production', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u', accountLabel: null, credentialType: 'vendor', worksFor: ['git'],
  tokenHint: { length: 40, last4: 'ab12', ciphertext: SECRET }, token: SECRET, ciphertext: SECRET, connection: { providerId: 'cdn', token: SECRET } };
const wireVerification = { status: 'valid', message: 'Connected', checkedAt: 't', accountLabel: 'acct', token: SECRET };
const verification = { status: 'valid', message: 'Connected', checkedAt: 't', accountLabel: 'acct' };
const projected = { credentialType: 'vendor', worksFor: ['git'], tokenHint: { length: 40, last4: 'ab12' }, id: 'a/b', providerId: 'cdn', label: 'Production', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u', accountLabel: null };
afterEach(() => { vi.restoreAllMocks(); });

describe('createHttpPublishCredentials (W1–W5, shared with Deployment)', () => {
  it('sends byte-identical requests and projects every response to the declared wire fields', async () => {
    const t = transport([{ credentials: [raw], executionMode: 'hosted-api-only', extra: SECRET }, { credential: raw, verification: wireVerification }, { credential: raw }, undefined, { verification: wireVerification }]);
    const api = createHttpPublishCredentials({ transport: t.port, workspacePath: `${W}/` });
    const list = await api.listPublishCredentials({});
    const created = await api.createPublishCredential({ label: 'Production', connection: { providerId: 'cdn', token: SECRET } });
    const updated = await api.updatePublishCredential({ id: 'a/b', input: { label: 'Renamed', isDefault: true } });
    await api.deletePublishCredential({ id: 'a/b' });
    const verified = await api.verifyPublishCredential({ id: 'a/b' });
    expect(t.calls.map(c => [c.method, c.path, JSON.stringify(c.body)])).toEqual([
      ['GET', `${W}/system/publish/credentials`, undefined],
      ['POST', `${W}/system/publish/credentials`, `{"label":"Production","connection":{"providerId":"cdn","token":"${SECRET}"}}`],
      ['PUT', `${W}/system/publish/credentials/a%2Fb`, '{"label":"Renamed","isDefault":true}'],
      ['DELETE', `${W}/system/publish/credentials/a%2Fb`, undefined],
      ['POST', `${W}/system/publish/credentials/a%2Fb/verify`, undefined],
    ]);
    expect(t.calls.every(c => !('body' in c) || c.body !== undefined)).toBe(true);
    expect(list).toEqual({ credentials: [projected], executionMode: 'hosted-api-only' });
    expect(created).toEqual({ credential: projected, verification });
    expect(updated).toEqual({ credential: projected });
    expect(verified).toEqual({ verification });
    expect(JSON.stringify([list, created, updated, verified])).not.toContain(SECRET);
  });
  it('keeps a null token hint null, omits an absent one, and never dispatches an aborted call', async () => {
    const t = transport([{ credentials: [{ ...raw, tokenHint: null }, { ...raw, id: 'x', tokenHint: undefined }], executionMode: 'self-hosted-cli' }]);
    const api = createHttpPublishCredentials({ transport: t.port, workspacePath: W });
    const { credentials } = await api.listPublishCredentials({});
    expect(credentials[0]?.tokenHint).toBeNull(); expect('tokenHint' in credentials[1]!).toBe(false);
    const c = new AbortController(); c.abort();
    await expect(api.verifyPublishCredential({ id: 'x' }, { signal: c.signal })).rejects.toThrow(); expect(t.calls).toHaveLength(1);
  });
});

describe('Security API publish store carries executionMode, credentialType, worksFor and verification', () => {
  it('snapshot, create and verify project server facts without secrets; only publish can verify', async () => {
    const t = transport([{ credentials: [raw], executionMode: 'self-hosted-cli' }, { credential: raw, verification: wireVerification }, { verification: wireVerification }, { credentials: [raw] }]);
    const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' });
    const snap = await api.publish.snapshot!({});
    expect(snap.executionMode).toBe('self-hosted-cli');
    expect(snap.rows[0]).toMatchObject({ kind: 'publish', credentialType: 'vendor', worksFor: ['git'] });
    const row = await api.publish.create({ label: 'Production', connection: { providerId: 'cdn', token: SECRET } });
    expect(row.lastVerification).toEqual(verification);
    expect(await api.publish.verify!({ id: 'a/b' })).toEqual(verification);
    expect(t.calls[2]).toEqual({ method: 'POST', path: '/w/system/publish/credentials/a%2Fb/verify' });
    const source = await api.sourceControl.snapshot!({});
    expect('executionMode' in source).toBe(false); expect(api.sourceControl.verify).toBeUndefined();
    expect(JSON.stringify([snap, row, source])).not.toContain(SECRET);
  });
});

describe('memory publish credentials', () => {
  it('passes the publish credential conformance contract', async () => {
    const result = await runPublishCredentialsConformance({ createClient: () => createMemoryPublishCredentials({ executionMode: 'hosted-api-only' }), connection: { providerId: 'cdn', token: SECRET } });
    expect(result.passed).toBeGreaterThanOrEqual(6);
  });
});

describe('access-tokens controller publish facts', () => {
  const providers: CredentialProvider[] = [{ kind: 'publish', id: 'cdn', label: 'CDN', vendorLabel: 'CDN vendor', category: 'hosting', tokenField: 'token', fields: [] }];
  const permissions = ['security.read', 'system.publish'];
  it('reads executionMode from the publish snapshot and keeps a save or verify result per row across refetch', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const memory = createMemorySecurityApi({ providers, executionMode: 'hosted-api-only' });
    const api = { ...memory, publish: { ...memory.publish, create: async (...args: Parameters<typeof memory.publish.create>) => ({ ...(await memory.publish.create(...args)), lastVerification: verification as never }) } };
    const c = createAccessTokensController({ api, permissions });
    await c.load({}); expect(c.getSnapshot().executionMode).toBe('hosted-api-only');
    c.begin({ kind: 'publish', providerId: 'cdn' }); c.setDraft({ patch: { label: 'Prod', token: SECRET } });
    expect(await c.save({})).toBe(true);
    const row = c.getSnapshot().rows[0]!;
    expect(c.getSnapshot().verifications[`publish:${row.id}`]).toEqual(verification);
    expect(await c.verify({ row })).toBe(true);
    expect(c.getSnapshot().verifications[`publish:${row.id}`]).toMatchObject({ status: 'valid' });
    expect(JSON.stringify(c.getSnapshot())).not.toContain(SECRET);
    for (const spy of [log, warn, error]) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });
  it('a store without verify refuses to verify', async () => {
    const c = createAccessTokensController({ api: createMemorySecurityApi({ providers, rows: [{ kind: 'source-control', id: 's', providerId: 'git', label: 'Git', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' }] }), permissions: [...permissions, 'source-control.credentials.write'] });
    await c.load({}); expect(await c.verify({ row: c.getSnapshot().rows[0]! })).toBe(false);
  });
});
