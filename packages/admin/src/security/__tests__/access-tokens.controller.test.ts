import { describe, it, expect, vi } from 'vitest';
import { createMemorySecurityApi } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import type { CredentialProvider, CredentialSummary } from '../models.js';
import type { CredentialStorePort } from '../ports.js';
const providers: CredentialProvider[] = [{ kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git', category: 'source-control', tokenField: 'token', fields: [] }, { kind: 'publish', id: 'cloud', label: 'Cloud', vendorLabel: 'Cloud', category: 'hosting', tokenField: 'token', fields: [] }];
const ALL = ['security.read', 'system.publish', 'source-control.credentials.write', 'custom-credentials.write'];
const row = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'source-control', id: 's1', providerId: 'git', label: 'Work', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd', ...over });
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function setup({ rows = [] as CredentialSummary[], permissions = ALL } = {}) { const api = createMemorySecurityApi({ providers, rows }); const c = createAccessTokensController({ api, permissions }); await c.load({}); return { api, c }; }
describe('access tokens controller: begin', () => {
  it('opens a blank draft for a provider', async () => { const { c } = await setup(); c.begin({ kind: 'publish', providerId: 'cloud' }); expect(c.getSnapshot().draft).toEqual({ kind: 'publish', providerId: 'cloud', label: '', token: '', values: {}, category: 'hosting', baseUrl: '', additionalHosts: '', username: '' }); });
  it('defaults a draft without kind to custom with no provider', async () => { const { c } = await setup(); c.begin({}); expect(c.getSnapshot().draft).toMatchObject({ kind: 'custom', providerId: '', category: 'general' }); });
  it('opens an edit draft from a row without its secret and with defaults', async () => {
    const { c } = await setup({ rows: [row({ label: 'default' })] }); c.begin({ row: c.getSnapshot().rows[0]! });
    expect(c.getSnapshot().draft).toEqual({ kind: 'source-control', providerId: 'git', id: 's1', label: 'Git host token', token: '', values: {}, category: 'source-control', baseUrl: '', additionalHosts: '', username: '' });
  });
  it('defaults a publish row to the hosting category', async () => { const { c } = await setup(); c.begin({ row: row({ kind: 'publish', providerId: 'cloud' }) }); expect(c.getSnapshot().draft?.category).toBe('hosting'); });
  it('defaults a custom row to the general category', async () => { const { c } = await setup(); c.begin({ row: row({ kind: 'custom', providerId: '' }) }); expect(c.getSnapshot().draft?.category).toBe('general'); });
  it('opens a custom edit draft with its stored metadata', async () => {
    const { c } = await setup(); c.begin({ row: row({ kind: 'custom', providerId: '', category: 'ai', baseUrl: 'https://a', additionalHosts: ['https://b', 'https://c'], username: 'me' }) });
    expect(c.getSnapshot().draft).toMatchObject({ kind: 'custom', category: 'ai', baseUrl: 'https://a', additionalHosts: 'https://b\nhttps://c', username: 'me' });
  });
  it('lets the row kind win over the requested kind', async () => { const { c } = await setup({ permissions: ['security.read', 'source-control.credentials.write'] }); c.begin({ row: row({}), kind: 'custom' }); expect(c.getSnapshot().draft?.kind).toBe('source-control'); });
  it('clears a previous error', async () => { const { c } = await setup(); c.begin({ kind: 'custom' }); await c.save({}); expect(c.getSnapshot().error).toBe('Enter a name'); c.begin({ kind: 'custom' }); expect(c.getSnapshot().error).toBeNull(); });
  it('refuses without the read grant', async () => { const { c } = await setup({ permissions: ['custom-credentials.write'] }); c.begin({ kind: 'custom' }); expect(c.getSnapshot().draft).toBeNull(); });
  it('refuses without the write grant for that kind', async () => { const { c } = await setup({ permissions: ['security.read', 'custom-credentials.write'] }); c.begin({ kind: 'publish', providerId: 'cloud' }); expect(c.getSnapshot().draft).toBeNull(); });
  it('refuses after disposal', async () => { const { c } = await setup(); c.dispose({}); c.begin({ kind: 'custom' }); expect(c.getSnapshot().draft).toBeNull(); });
  it('refuses while saving', async () => {
    const { api, c } = await setup(); const gate = deferred<CredentialSummary>(); api.custom.create = () => gate.promise;
    c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'A', token: 't', baseUrl: 'https://a' } }); const saving = c.save({}); c.begin({ kind: 'publish', providerId: 'cloud' });
    expect(c.getSnapshot().draft?.kind).toBe('custom'); gate.reject(new Error('stop')); await saving;
  });
});
describe('access tokens controller: load', () => {
  it('does not read without the read grant', async () => { const api = createMemorySecurityApi({ providers }); const spy = vi.spyOn(api.custom, 'list'); await createAccessTokensController({ api, permissions: [] }).load({}); expect(spy).not.toHaveBeenCalled(); });
  it('loads every store and the provider catalog', async () => { const { c } = await setup({ rows: [row({}), row({ kind: 'custom', id: 'c1', providerId: '' })] }); expect(c.getSnapshot()).toMatchObject({ loading: false, error: null, errors: {}, providers }); expect(c.getSnapshot().rows.map(r => r.id)).toEqual(['s1', 'c1']); });
  it('reports an unavailable provider catalog', async () => { const api = createMemorySecurityApi({ providers }); api.providers = () => Promise.reject(new Error('down')); const c = createAccessTokensController({ api, permissions: ALL }); await c.load({}); expect(c.getSnapshot().error).toBe('Provider catalog unavailable'); });
  it('clears a store error once that store recovers', async () => {
    const api = createMemorySecurityApi({ providers }); const real = api.publish.list; api.publish.list = () => Promise.reject(new Error('down'));
    const c = createAccessTokensController({ api, permissions: ALL }); await c.load({}); expect(c.getSnapshot().errors).toEqual({ publish: 'Credential store unavailable' });
    api.publish.list = real; await c.load({}); expect(c.getSnapshot().errors).toEqual({});
  });
  it('ignores a superseded load', async () => {
    const api = createMemorySecurityApi({ providers }); const first = deferred<readonly CredentialProvider[]>(); const failing = deferred<readonly CredentialSummary[]>(); let calls = 0;
    api.providers = () => (++calls === 1 ? first.promise : Promise.resolve(providers)); let lists = 0; const real = api.custom.list; api.custom.list = (r, o) => (++lists === 1 ? failing.promise : real(r, o));
    const c = createAccessTokensController({ api, permissions: ALL }); const stale = c.load({}); await c.load({}); first.reject(new Error('late')); failing.reject(new Error('late')); await stale;
    expect(c.getSnapshot()).toMatchObject({ error: null, errors: {}, providers, loading: false });
  });
  it('ignores a superseded successful load', async () => {
    const api = createMemorySecurityApi({ providers }); const first = deferred<readonly CredentialProvider[]>(); const late = deferred<readonly CredentialSummary[]>(); let calls = 0;
    api.providers = () => (++calls === 1 ? first.promise : Promise.resolve([])); let lists = 0; const real = api.custom.list; api.custom.list = (r, o) => (++lists === 1 ? late.promise : real(r, o));
    const c = createAccessTokensController({ api, permissions: ALL }); const stale = c.load({}); await c.load({}); first.resolve(providers); late.resolve([row({ kind: 'custom', id: 'late' })]); await stale;
    expect(c.getSnapshot().providers).toEqual([]); expect(c.getSnapshot().rows).toEqual([]);
  });
});
describe('access tokens controller: save', () => {
  it('returns false without a draft', async () => { const { c } = await setup(); expect(await c.save({})).toBe(false); });
  it('shows a validation error and keeps the draft', async () => { const { c } = await setup(); c.begin({ kind: 'custom' }); expect(await c.save({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ error: 'Enter a name', saving: false }); expect(c.getSnapshot().draft).not.toBeNull(); });
  it('creates a new credential and refetches', async () => {
    const { api, c } = await setup(); const create = vi.spyOn(api.custom, 'create'); c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Api', token: ' t ', baseUrl: 'https://a' } });
    expect(await c.save({})).toBe(true); expect(create).toHaveBeenCalledWith({ label: 'Api', connection: { token: 't' }, category: 'general', baseUrl: 'https://a', additionalHosts: [], username: null }, { signal: expect.any(AbortSignal) }); expect(c.getSnapshot()).toMatchObject({ draft: null, saving: false, error: null });
  });
  it('updates an existing credential by id', async () => { const { api, c } = await setup({ rows: [row({})] }); const update = vi.spyOn(api.sourceControl, 'update'); c.begin({ row: c.getSnapshot().rows[0]! }); c.setDraft({ patch: { label: 'New' } }); expect(await c.save({})).toBe(true); expect(update).toHaveBeenCalledWith({ id: 's1', patch: { label: 'New' } }, { signal: expect.any(AbortSignal) }); });
  it('reports a refused save without leaking the cause and keeps the draft', async () => {
    const { api, c } = await setup(); api.custom.create = () => Promise.reject(new Error('PRIVATE_CAUSE')); c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Api', token: 't', baseUrl: 'https://a' } });
    expect(await c.save({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ error: 'Unable to save credential', saving: false }); expect(c.getSnapshot().draft?.label).toBe('Api'); expect(JSON.stringify(c.getSnapshot())).not.toContain('PRIVATE_CAUSE');
  });
  it('refuses a second save while one is pending', async () => {
    const { api, c } = await setup(); const gate = deferred<CredentialSummary>(); const create = vi.fn<CredentialStorePort['create']>(() => gate.promise); api.custom.create = create;
    c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Api', token: 't', baseUrl: 'https://a' } }); const first = c.save({}); expect(await c.save({})).toBe(false); expect(create).toHaveBeenCalledTimes(1); gate.reject(new Error('x')); await first;
  });
  it('returns false when disposed during the save', async () => {
    const { api, c } = await setup(); const gate = deferred<CredentialSummary>(); api.custom.create = () => gate.promise;
    c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'Api', token: 't', baseUrl: 'https://a' } }); const saving = c.save({}); c.dispose({}); gate.resolve(row({ kind: 'custom', id: 'c9' })); expect(await saving).toBe(false);
  });
});
describe('access tokens controller: remove, default and draft guards', () => {
  it('removes a credential and refetches', async () => { const { c } = await setup({ rows: [row({})] }); expect(await c.remove({ row: c.getSnapshot().rows[0]! })).toBe(true); expect(c.getSnapshot().rows).toEqual([]); });
  it('makes a credential default through update', async () => { const { api, c } = await setup({ rows: [row({})] }); const update = vi.spyOn(api.sourceControl, 'update'); expect(await c.makeDefault({ row: row({}) })).toBe(true); expect(update).toHaveBeenCalledWith({ id: 's1', patch: { isDefault: true } }, { signal: expect.any(AbortSignal) }); });
  it('never makes a custom credential default', async () => { const { api, c } = await setup(); const update = vi.spyOn(api.custom, 'update'); expect(await c.makeDefault({ row: row({ kind: 'custom' }) })).toBe(false); expect(update).not.toHaveBeenCalled(); });
  it('reports a refused remove', async () => { const { api, c } = await setup({ rows: [row({})] }); api.sourceControl.remove = () => Promise.reject(new Error('x')); expect(await c.remove({ row: row({}) })).toBe(false); expect(c.getSnapshot()).toMatchObject({ error: 'Unable to update credential', saving: false }); });
  it('refuses a remove without the write grant', async () => { const { api, c } = await setup({ rows: [row({})], permissions: ['security.read'] }); const remove = vi.spyOn(api.sourceControl, 'remove'); expect(await c.remove({ row: row({}) })).toBe(false); expect(remove).not.toHaveBeenCalled(); });
  it('refuses a remove while saving', async () => {
    const { api, c } = await setup({ rows: [row({})] }); const gate = deferred<void>(); const remove = vi.fn<CredentialStorePort['remove']>(() => gate.promise); api.sourceControl.remove = remove;
    const first = c.remove({ row: row({}) }); expect(await c.makeDefault({ row: row({}) })).toBe(false); expect(remove).toHaveBeenCalledTimes(1); gate.resolve(); await first;
  });
  it('returns false when disposed during a remove', async () => { const { api, c } = await setup({ rows: [row({})] }); const gate = deferred<void>(); api.sourceControl.remove = () => gate.promise; const pending = c.remove({ row: row({}) }); c.dispose({}); gate.resolve(); expect(await pending).toBe(false); });
  it('ignores draft edits without a draft, when denied, or while saving', async () => {
    const { api, c } = await setup(); c.setDraft({ patch: { label: 'x' } }); expect(c.getSnapshot().draft).toBeNull();
    const gate = deferred<CredentialSummary>(); api.custom.create = () => gate.promise; c.begin({ kind: 'custom' }); c.setDraft({ patch: { label: 'A', token: 't', baseUrl: 'https://a' } }); const saving = c.save({});
    c.setDraft({ patch: { label: 'B' } }); c.cancel({}); expect(c.getSnapshot().draft?.label).toBe('A'); gate.reject(new Error('x')); await saving;
    c.cancel({}); expect(c.getSnapshot().draft).toBeNull();
  });
  it('filters by query and category independently', async () => { const { c } = await setup(); c.filter({ query: 'git' }); c.filter({ category: 'ai' }); expect(c.getSnapshot()).toMatchObject({ query: 'git', category: 'ai' }); c.filter({}); expect(c.getSnapshot()).toMatchObject({ query: 'git', category: 'ai' }); });
});
