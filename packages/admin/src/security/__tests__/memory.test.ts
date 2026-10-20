import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemorySecurityApi, createMemoryOtherCredentials, createMemoryRootKey } from '../adapters/memory.js';
import type { CredentialSummary, OtherCredentialSummary, RootKeyStatus } from '../models.js';
const aborted = () => { const c = new AbortController(); c.abort(); return c.signal; };
const saved = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'publish', id: 'p1', providerId: 'cloud', label: 'Work', configured: true, isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over });
const NOW = '2026-05-05T05:05:05.000Z';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });
describe('memory credential stores', () => {
  it('creates the first credential for a provider as its default', async () => {
    const api = createMemorySecurityApi({});
    expect(await api.publish.create({ label: 'Work', connection: { providerId: 'cloud', token: 't' } })).toEqual({ kind: 'publish', id: 'credential-1', providerId: 'cloud', label: 'Work', configured: true, isDefault: true, createdAt: NOW, updatedAt: NOW });
  });
  it('creates a later credential for the same provider as non-default', async () => {
    const api = createMemorySecurityApi({ rows: [saved({})] });
    expect((await api.publish.create({ label: 'Home', connection: { providerId: 'cloud', token: 't' } })).isDefault).toBe(false);
  });
  it('creates a credential without a provider id under the empty provider', async () => {
    expect((await createMemorySecurityApi({}).sourceControl.create({ label: 'Git', connection: { token: 't' } })).providerId).toBe('');
  });
  it('honours an explicit default on create and demotes the previous default', async () => {
    const api = createMemorySecurityApi({ rows: [saved({})] }); await api.publish.create({ label: 'Home', connection: { providerId: 'cloud', token: 't' }, isDefault: true });
    expect((await api.publish.list({})).map(r => [r.label, r.isDefault])).toEqual([['Work', false], ['Home', true]]);
  });
  it('never makes a custom credential default and fills custom defaults', async () => {
    expect(await createMemorySecurityApi({}).custom.create({ label: 'Api', connection: { token: 't', providerId: 'ignored' } })).toEqual({ kind: 'custom', id: 'credential-1', providerId: '', label: 'Api', configured: true, isDefault: false, createdAt: NOW, updatedAt: NOW, category: 'general', baseUrl: '', additionalHosts: [] });
  });
  it('takes the custom username from the connection when no explicit username is given', async () => {
    expect((await createMemorySecurityApi({}).custom.create({ label: 'Api', connection: { token: 't', username: 'me' }, category: 'ai', baseUrl: 'https://a', additionalHosts: ['https://b'] }))).toMatchObject({ category: 'ai', baseUrl: 'https://a', additionalHosts: ['https://b'], username: 'me' });
  });
  it('refuses a create whose connection is all blank', async () => { await expect(createMemorySecurityApi({}).publish.create({ label: 'Work', connection: { token: '  ' } })).rejects.toThrow(/^Incomplete credential$/); });
  it('refuses a create with a blank label', async () => { await expect(createMemorySecurityApi({}).publish.create({ label: ' ', connection: { token: 't' } })).rejects.toThrow(/^Incomplete credential$/); });
  it('refuses a duplicate label under the same provider ignoring case', async () => { await expect(createMemorySecurityApi({ rows: [saved({})] }).publish.create({ label: 'WORK', connection: { providerId: 'cloud', token: 't' } })).rejects.toThrow(/^Duplicate label$/); });
  it('allows the same label under another provider', async () => { expect((await createMemorySecurityApi({ rows: [saved({})] }).publish.create({ label: 'Work', connection: { providerId: 'other', token: 't' } })).label).toBe('Work'); });
  it('refuses a duplicate custom label across providers', async () => { await expect(createMemorySecurityApi({ rows: [saved({ kind: 'custom', providerId: 'x' })] }).custom.create({ label: 'work', connection: { token: 't' } })).rejects.toThrow(/^Duplicate label$/); });
  it('does not dispatch aborted list or create', async () => {
    const api = createMemorySecurityApi({});
    await expect(api.publish.list({}, { signal: aborted() })).rejects.toThrow('This operation was aborted');
    await expect(api.publish.create({ label: 'W', connection: { token: 't' } }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
  });
  it('updates metadata while keeping identity, creation time and default', async () => {
    expect(await createMemorySecurityApi({ rows: [saved({})] }).publish.update({ id: 'p1', patch: {} })).toEqual(saved({ updatedAt: NOW }));
  });
  it('applies an explicit default flag on update', async () => {
    expect((await createMemorySecurityApi({ rows: [saved({})] }).publish.update({ id: 'p1', patch: { isDefault: false, label: 'Renamed' } }))).toMatchObject({ isDefault: false, label: 'Renamed' });
  });
  it('keeps stored custom metadata when the patch omits it', async () => {
    const row = saved({ kind: 'custom', id: 'c1', providerId: '', isDefault: false, category: 'ops', baseUrl: 'https://a', additionalHosts: ['https://b'], username: 'me' });
    expect(await createMemorySecurityApi({ rows: [row] }).custom.update({ id: 'c1', patch: {} })).toEqual({ ...row, updatedAt: NOW });
  });
  it('clears a stored custom username with null', async () => {
    expect(await createMemorySecurityApi({ rows: [saved({ kind: 'custom', id: 'c1', providerId: '', username: 'me' })] }).custom.update({ id: 'c1', patch: { username: null } })).not.toHaveProperty('username');
  });
  it('prefers an explicit username over the connection username', async () => {
    expect((await createMemorySecurityApi({ rows: [saved({ kind: 'custom', id: 'c1', providerId: '' })] }).custom.update({ id: 'c1', patch: { username: 'explicit', connection: { token: 't', username: 'conn' } } })).username).toBe('explicit');
  });
  it('refuses an update of an unknown or other-kind credential', async () => {
    const api = createMemorySecurityApi({ rows: [saved({})] });
    await expect(api.sourceControl.update({ id: 'p1', patch: {} })).rejects.toThrow(/^Credential not found$/);
  });
  it('refuses renaming onto another credential name but allows keeping its own', async () => {
    const api = createMemorySecurityApi({ rows: [saved({}), saved({ id: 'p2', label: 'Home', isDefault: false })] });
    await expect(api.publish.update({ id: 'p2', patch: { label: 'work' } })).rejects.toThrow(/^Duplicate label$/);
    expect((await api.publish.update({ id: 'p2', patch: {} })).label).toBe('Home');
  });
  it('does not dispatch an aborted update or remove', async () => {
    const api = createMemorySecurityApi({ rows: [saved({})] });
    await expect(api.publish.update({ id: 'p1', patch: {} }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
    await expect(api.publish.remove({ id: 'p1' }, { signal: aborted() })).rejects.toThrow('This operation was aborted'); expect(await api.publish.list({})).toHaveLength(1);
  });
  it('promotes the most recently updated sibling when the default is removed', async () => {
    const api = createMemorySecurityApi({ rows: [saved({}), saved({ id: 'old', label: 'Old', isDefault: false, updatedAt: '2026-02-01T00:00:00.000Z' }), saved({ id: 'new', label: 'New', isDefault: false, updatedAt: '2026-03-01T00:00:00.000Z' }), saved({ id: 'elsewhere', label: 'E', providerId: 'other', isDefault: false, updatedAt: '2026-04-01T00:00:00.000Z' })] });
    await api.publish.remove({ id: 'p1' }); expect((await api.publish.list({})).filter(r => r.isDefault).map(r => r.id)).toEqual(['new']);
  });
  it('leaves no default when the removed default had no sibling', async () => { const api = createMemorySecurityApi({ rows: [saved({})] }); await api.publish.remove({ id: 'p1' }); expect(await api.publish.list({})).toEqual([]); });
  it('does not promote anything when a non-default is removed, and is idempotent', async () => {
    const api = createMemorySecurityApi({ rows: [saved({ isDefault: false }), saved({ id: 'p2', label: 'Home', isDefault: false })] });
    await api.publish.remove({ id: 'p1' }); await api.publish.remove({ id: 'p1' }); expect((await api.publish.list({})).map(r => [r.id, r.isDefault])).toEqual([['p2', false]]);
  });
  it('serves its configured providers and refuses an aborted provider read', async () => {
    const providers = [{ kind: 'publish' as const, id: 'cloud', label: 'Cloud', vendorLabel: 'Cloud', category: 'hosting' as const, tokenField: 'token', fields: [] }]; const api = createMemorySecurityApi({ providers });
    expect(await api.providers({})).toBe(providers); await expect(api.providers({}, { signal: aborted() })).rejects.toThrow('This operation was aborted');
  });
});
describe('memory other credentials', () => {
  const rows: OtherCredentialSummary[] = [{ store: 'site-assistant', id: 'site-assistant', label: 'A', category: 'ai', configured: false, supportsReplace: true }, { store: 'external-mcp', id: 'm', label: 'M', category: 'ai', configured: true, supportsReplace: false }];
  it('lists only the requested store', async () => { expect((await createMemoryOtherCredentials({ rows }).list({ store: 'external-mcp' })).map(r => r.id)).toEqual(['m']); });
  it('marks a replaced row configured and updated', async () => { const api = createMemoryOtherCredentials({ rows }); await api.replace({ store: 'site-assistant', id: 'site-assistant', token: 'k' }); expect(await api.list({ store: 'site-assistant' })).toEqual([{ ...rows[0], configured: true, updatedAt: NOW }]); });
  it('refuses replacing a row that does not support it', async () => { await expect(createMemoryOtherCredentials({ rows }).replace({ store: 'external-mcp', id: 'm', token: 'k' })).rejects.toThrow(/^Replacement unavailable$/); });
  it('refuses replacing an unknown row', async () => { await expect(createMemoryOtherCredentials({ rows }).replace({ store: 'admin-byok', id: 'x', token: 'k' })).rejects.toThrow(/^Replacement unavailable$/); });
  it('refuses a blank replacement', async () => { await expect(createMemoryOtherCredentials({ rows }).replace({ store: 'site-assistant', id: 'site-assistant', token: ' ' })).rejects.toThrow(/^Replacement unavailable$/); });
  it('removes only the matching store and id', async () => { const api = createMemoryOtherCredentials({ rows: [...rows, { ...rows[1]!, id: 'n' }] }); await api.remove({ store: 'external-mcp', id: 'm' }); expect((await api.list({ store: 'external-mcp' })).map(r => r.id)).toEqual(['n']); expect(await api.list({ store: 'site-assistant' })).toHaveLength(1); });
  it('refuses aborted calls', async () => {
    const api = createMemoryOtherCredentials({});
    await expect(api.list({ store: 'admin-byok' }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
    await expect(api.replace({ store: 'admin-byok', id: 'x', token: 'k' }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
    await expect(api.remove({ store: 'admin-byok', id: 'x' }, { signal: aborted() })).rejects.toThrow('This operation was aborted');
  });
});
describe('memory root key', () => {
  const status = (over: Partial<RootKeyStatus>): RootKeyStatus => ({ active: false, source: 'none', state: 'missing', keyFilePath: '/k', runtimeMode: 'production', ...over });
  it('starts missing by default', async () => { expect(await createMemoryRootKey({}).status({})).toEqual({ active: false, source: 'none', state: 'missing', keyFilePath: '/memory/key', runtimeMode: 'local' }); });
  it('creates a key when missing and becomes active', async () => {
    const api = createMemoryRootKey({ status: status({}) });
    expect(await api.generate({})).toEqual({ outcome: 'created', fingerprint: 'memory-fingerprint', keyFilePath: '/k', runtimeMode: 'production' });
    expect(await api.status({})).toEqual({ active: true, source: 'file', state: 'active', keyFilePath: '/k', runtimeMode: 'production', fingerprint: 'memory-fingerprint' });
  });
  it('reports an already active key without failing', async () => { expect((await createMemoryRootKey({ status: status({ active: true, state: 'active' }) }).generate({})).outcome).toBe('already-active'); });
  it('refuses to create a key over dependent data', async () => { await expect(createMemoryRootKey({ status: status({ state: 'missing-with-data' }) }).generate({})).rejects.toThrow(/^Key dependent data$/); });
  it('unlocks with a 64-hex token of either case', async () => { expect(await createMemoryRootKey({ status: status({ state: 'mismatch' }) }).importToken({ token: 'aB'.repeat(32) })).toEqual({ outcome: 'unlocked', fingerprint: 'memory-fingerprint', keyFilePath: '/k', runtimeMode: 'production', resealed: 0 }); });
  it('refuses a malformed token', async () => { await expect(createMemoryRootKey({}).importToken({ token: 'g'.repeat(64) })).rejects.toThrow(/^Invalid token$/); });
  it('refuses a short token', async () => { await expect(createMemoryRootKey({}).importToken({ token: 'a'.repeat(63) })).rejects.toThrow(/^Invalid token$/); });
  it('serves its preview', async () => { expect(await createMemoryRootKey({}).previewStartFresh({})).toEqual({ removes: 0, affectedWebhooks: [], detail: 'Remove saved credentials and create a new root key.', runtimeMode: 'local' }); });
  it('starts fresh only with the exact confirmation', async () => {
    const preview = { removes: 3, affectedWebhooks: [{ label: 'H', targetUrl: 'https://h' }], detail: 'd', runtimeMode: 'local' as const }; const api = createMemoryRootKey({ preview });
    await expect(api.startFresh({ confirm: 'start fresh' })).rejects.toThrow(/^Confirmation required$/);
    expect(await api.startFresh({ confirm: 'START FRESH' })).toEqual({ outcome: 'started-fresh', fingerprint: 'memory-fingerprint', keyFilePath: '/memory/key', runtimeMode: 'local', discarded: 3, kept: 0, affectedWebhooks: preview.affectedWebhooks, restorePointId: 'memory-restore-point' });
  });
  it('refuses aborted calls', async () => {
    const api = createMemoryRootKey({}); const signal = aborted();
    for (const call of [() => api.status({}, { signal }), () => api.generate({}, { signal }), () => api.importToken({ token: 'a'.repeat(64) }, { signal }), () => api.previewStartFresh({}, { signal }), () => api.startFresh({ confirm: 'START FRESH' }, { signal })]) await expect(call()).rejects.toThrow('This operation was aborted');
    expect((await api.status({})).active).toBe(false);
  });
});
