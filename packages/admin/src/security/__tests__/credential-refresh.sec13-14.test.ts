import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMemorySecurityApi, createMemoryOtherCredentials } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../controllers/other-credentials.controller.js';
import type { SecurityRefreshSignal } from '../ports.js';
import type { CredentialProvider, CredentialStoreSnapshot, OtherCredentialSummary } from '../models.js';
const providers: CredentialProvider[] = [{ kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] }];
const ACCESS = ['security.read', 'source-control.credentials.write', 'custom-credentials.write'];
const OTHER = ['security.read', 'admin.assistant.manage', 'admin.integrations.manage'];
const media = (id: string): OtherCredentialSummary => ({ store: 'media-provider', id, label: id, category: 'media', configured: true, supportsReplace: true });
/** A host content-refresh subscription: counts live listeners so a leak after dispose shows. */
function refreshSignal() {
  const listeners = new Set<() => void>();
  const signal: SecurityRefreshSignal = { subscribe({ onRefresh }) { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
  return { signal, listeners, fire() { for (const listener of [...listeners]) listener(); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); });

describe('SEC-14 host refresh', () => {
  it('a refresh signal reloads every store once, for both controllers', async () => {
    const r = refreshSignal(); const api = createMemorySecurityApi({ providers }); const other = createMemoryOtherCredentials({ rows: [] });
    const reads = { access: vi.spyOn(api.sourceControl, 'list'), publish: vi.spyOn(api.publish, 'list'), custom: vi.spyOn(api.custom, 'list'), other: vi.spyOn(other, 'list') };
    const a = createAccessTokensController({ api, permissions: ACCESS }, { refreshSignal: r.signal }); const o = createOtherCredentialsController({ api: other, permissions: OTHER }, { refreshSignal: r.signal });
    expect(r.listeners.size).toBe(2);
    r.fire(); await flush();
    expect([reads.access.mock.calls.length, reads.publish.mock.calls.length, reads.custom.mock.calls.length]).toEqual([1, 1, 1]);
    expect(reads.other.mock.calls.map(([q]) => q.store)).toEqual(['site-assistant', 'admin-byok', 'media-provider', 'external-mcp']);
    a.dispose({}); o.dispose({});
  });
  it('dispose unsubscribes: the listener count after dispose is 0 and a late signal reads nothing', async () => {
    const r = refreshSignal(); const other = createMemoryOtherCredentials({ rows: [] }); const read = vi.spyOn(other, 'list');
    const a = createAccessTokensController({ api: createMemorySecurityApi({ providers }), permissions: ACCESS }, { refreshSignal: r.signal }); const o = createOtherCredentialsController({ api: other, permissions: OTHER }, { refreshSignal: r.signal });
    a.dispose({}); o.dispose({}); expect(r.listeners.size).toBe(0); r.fire(); await flush(); expect(read).not.toHaveBeenCalled();
  });
  it('an older overlapping read that resolves last is ignored (access tokens)', async () => {
    const api = createMemorySecurityApi({ providers }); const late = deferred<CredentialStoreSnapshot>(); let call = 0;
    const row = (label: string) => ({ kind: 'source-control' as const, id: label, providerId: 'git', label, configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' });
    api.sourceControl.snapshot = () => (++call === 1 ? late.promise : Promise.resolve({ rows: [row('fresh')] }));
    const c = createAccessTokensController({ api, permissions: ACCESS }); const first = c.load({}); await c.load({});
    late.resolve({ rows: [row('stale')] }); await first;
    expect(c.getSnapshot().rows.map(r => r.label)).toEqual(['fresh']); c.dispose({});
  });
  it('an older overlapping read that resolves last is ignored (other stores)', async () => {
    const api = createMemoryOtherCredentials({ rows: [] }); const late = deferred<readonly OtherCredentialSummary[]>(); let call = 0;
    api.list = async ({ store }) => store !== 'media-provider' ? [] : ++call === 1 ? late.promise : [media('fresh')];
    const c = createOtherCredentialsController({ api, permissions: OTHER }); const first = c.load({}); await c.load({});
    late.resolve([media('stale')]); await first;
    expect(c.getSnapshot().rows.map(r => r.id)).toEqual(['fresh']); c.dispose({});
  });
});

describe('SEC-13 per-row feedback and placeholders', () => {
  it('marks the pending row while it writes and keeps a failed write on that row only', async () => {
    const rows = [media('a'), media('b')]; const api = createMemoryOtherCredentials({ rows }); const gate = deferred<void>();
    api.remove = async () => { await gate.promise; throw new Error('backend detail'); };
    const c = createOtherCredentialsController({ api, permissions: OTHER }); await c.load({});
    const removing = c.remove({ row: rows[0]! }); await flush(); expect(c.getSnapshot().pending).toBe('media-provider:a');
    gate.resolve(); expect(await removing).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ pending: null, saving: false, rowErrors: { 'media-provider:a': 'Unable to update credential' }, errors: {} });
  });
  it('records which stores settled, so an empty store can render as a placeholder only after its read', async () => {
    const api = createMemoryOtherCredentials({ rows: [media('a')] }); const real = api.list;
    api.list = (q, o) => q.store === 'external-mcp' ? Promise.reject(new Error('down')) : real(q, o);
    const c = createOtherCredentialsController({ api, permissions: OTHER }); expect(c.getSnapshot().loaded).toEqual({}); await c.load({});
    expect(c.getSnapshot().loaded).toEqual({ 'site-assistant': true, 'admin-byok': true, 'media-provider': true });
  });
});

describe('SEC-14 redacted, actionable failures', () => {
  it('no draft token appears in any error or diagnostic (other stores)', async () => {
    const log = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    const row: OtherCredentialSummary = { store: 'site-assistant', id: 'site-assistant', label: 'Assistant', category: 'ai', configured: true, supportsReplace: true };
    const api = createMemoryOtherCredentials({ rows: [row] }); api.replace = async ({ token }) => { throw new Error(`Rejected ${token}`); };
    const describeError = vi.fn(({ error }: { error: unknown }) => `Provider said: ${(error as Error).message}. Check the key and try again.`);
    const c = createOtherCredentialsController({ api, permissions: OTHER }, { describeError }); await c.load({});
    c.setDraft({ key: 'site-assistant:site-assistant', token: '  fixture-token-123  ' }); expect(await c.replace({ row })).toBe(false);
    const text = c.getSnapshot().rowErrors['site-assistant:site-assistant']!;
    expect(text).toBe('Provider said: Rejected [redacted]. Check the key and try again.');
    expect(JSON.stringify({ errors: c.getSnapshot().errors, rowErrors: c.getSnapshot().rowErrors })).not.toContain('fixture-token-123');
    for (const spy of log) expect(JSON.stringify(spy.mock.calls)).not.toContain('fixture-token-123');
  });
  it('no draft token appears in any error or diagnostic (access tokens)', async () => {
    const api = createMemorySecurityApi({ providers }); api.sourceControl.create = async () => { throw new Error('bad token fixture-token-456'); };
    const c = createAccessTokensController({ api, permissions: ACCESS }, { describeError: ({ error }) => (error as Error).message }); await c.load({});
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'Mine', token: 'fixture-token-456' } }); expect(await c.save({})).toBe(false);
    expect(c.getSnapshot().error).toBe('bad token [redacted]');
  });
  it("a refusal's detail reaches the screen only through describeError", async () => {
    const api = createMemorySecurityApi({ providers }); api.sourceControl.create = async () => { throw Object.assign(new Error('INTERNAL_DETAIL'), { code: 'LABEL_TAKEN' }); };
    const plain = createAccessTokensController({ api, permissions: ACCESS }); await plain.load({});
    plain.begin({ kind: 'source-control', providerId: 'git' }); plain.setDraft({ patch: { label: 'Mine', token: 'fixture-token' } }); await plain.save({});
    expect(plain.getSnapshot().error).toBe('Unable to save credential');
    const described = createAccessTokensController({ api, permissions: ACCESS }, { describeError: ({ error }) => (error as { code?: string }).code === 'LABEL_TAKEN' ? 'That name is taken. Choose another.' : undefined }); await described.load({});
    described.begin({ kind: 'source-control', providerId: 'git' }); described.setDraft({ patch: { label: 'Mine', token: 'fixture-token' } }); await described.save({});
    expect(described.getSnapshot().error).toBe('That name is taken. Choose another.');
  });
});
