import { describe, it, expect, vi } from 'vitest';
import { createMemorySecurityApi, createMemoryOtherCredentials, createMemoryRootKey } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../controllers/other-credentials.controller.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import { runSecurityApiConformance } from '../conformance/security-api.conformance.js';
const providers = [{ kind: 'source-control' as const, id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control' as const, tokenField: 'token', fields: [] }];
const grants = ['security.read', 'source-control.credentials.write', 'custom-credentials.write'];
describe('security controller contract', () => {
  it('runs the behavioral conformance against memory', async () => { expect(await runSecurityApiConformance({ createApi: () => createMemorySecurityApi({ providers }), provider: providers[0]! })).toEqual({ passed: 8 }); });
  it('creates multiple identities, clears drafts, preserves secrets on rename, and refetches promoted defaults', async () => {
    const api = createMemorySecurityApi({ providers }); const c = createAccessTokensController({ api, permissions: grants }); await c.load({});
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'First', token: 'NEVER_DISPLAY' } }); expect(await c.save({})).toBe(true); expect(JSON.stringify(c.getSnapshot())).not.toContain('NEVER_DISPLAY');
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'Second', token: 'SECOND_SECRET' } }); await c.save({});
    const first = c.getSnapshot().rows[0]!; c.begin({ row: first }); c.setDraft({ patch: { label: 'Renamed' } }); expect(await c.save({})).toBe(true); expect(c.getSnapshot().rows.find(r => r.id === first.id)?.label).toBe('Renamed');
    await c.remove({ row: c.getSnapshot().rows.find(r => r.id === first.id)! }); expect(c.getSnapshot().rows[0]?.isDefault).toBe(true); c.dispose({});
  });
  it('fails closed without read or write grants and rejects duplicate names', async () => {
    const api = createMemorySecurityApi({ providers }); const denied = createAccessTokensController({ api }); const spy = vi.spyOn(api, 'providers'); await denied.load({}); expect(spy).not.toHaveBeenCalled(); denied.begin({ kind: 'source-control', providerId: 'git' }); expect(await denied.save({})).toBe(false);
    const c = createAccessTokensController({ api, permissions: grants }); await c.load({});
    for (let n = 0; n < 2; n++) { c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'Same', token: 'secret' } }); await c.save({}); }
    expect(c.getSnapshot().rows).toHaveLength(1); expect(c.getSnapshot().error).toBe('That name is already in use');
  });
  it('retains successful writes without retaining the secret when refetch fails', async () => {
    const api = createMemorySecurityApi({ providers }); const c = createAccessTokensController({ api, permissions: grants }); await c.load({});
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'First', token: 'SECRET' } }); await c.save({});
    c.begin({ row: c.getSnapshot().rows[0]! }); c.setDraft({ patch: { token: 'NEW_SECRET' } }); api.sourceControl.list = () => Promise.reject(new Error('PRIVATE_ERROR_SECRET')); expect(await c.save({})).toBe(true); expect(c.getSnapshot().draft).toBeNull();
    await c.load({}); expect(c.getSnapshot().rows).toHaveLength(1); expect(JSON.stringify(c.getSnapshot())).not.toContain('PRIVATE_ERROR_SECRET');
  });
  it('ignores late reads after disposal and aborts transport ownership', async () => {
    const api = createMemorySecurityApi({ providers }); let done!: (v: readonly typeof providers[number][]) => void; let signal: AbortSignal | undefined;
    api.providers = (_r, options) => { signal = options?.signal; return new Promise(r => { done = r; }); };
    const c = createAccessTokensController({ api, permissions: grants }); const loading = c.load({}); c.dispose({}); const snapshot = c.getSnapshot(); done(providers); await loading; expect(signal?.aborted).toBe(true); expect(c.getSnapshot()).toBe(snapshot);
  });
  it('settles other stores independently and clears accepted replacement material', async () => {
    const api = createMemoryOtherCredentials({ rows: [{ store: 'site-assistant', id: 'site-assistant', label: 'Assistant', category: 'ai', configured: true, supportsReplace: true }] });
    const real = api.list; api.list = (r, o) => r.store === 'external-mcp' ? Promise.reject(new Error('hidden')) : real(r, o);
    const c = createOtherCredentialsController({ api, permissions: ['security.read', 'admin.assistant.manage'] }); await c.load({}); expect(c.getSnapshot().rows).toHaveLength(1); expect(c.getSnapshot().errors['external-mcp']).toBe('Credential store unavailable');
    c.setDraft({ key: 'site-assistant:site-assistant', token: 'KEY' }); expect(await c.replace({ row: c.getSnapshot().rows[0]! })).toBe(true); expect(c.getSnapshot().drafts).toEqual({});
  });
  it('requires a successful preview and typed confirmation before key recovery', async () => {
    const api = createMemoryRootKey({ status: { active: false, source: 'none', state: 'missing-with-data', keyFilePath: '/key', runtimeMode: 'local' } });
    const c = createRootKeyController({ api, permissions: ['admin.security.tokens.manage'] }); await c.load({}); expect(await c.generate({})).toBe(false);
    c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(false); await c.preview({}); c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(true); expect(c.getSnapshot().status?.active).toBe(true);
  });
  it('clears old-key paste immediately on accepted recovery and refuses active generation', async () => {
    const api = createMemoryRootKey({ status: { active: false, source: 'none', state: 'missing-with-data', keyFilePath: '/key', runtimeMode: 'local' } }); const c = createRootKeyController({ api, permissions: ['admin.security.tokens.manage'] }); await c.load({}); c.setToken({ value: '0'.repeat(64) }); expect(await c.importToken({})).toBe(true); expect(c.getSnapshot().token).toBe(''); expect(await c.generate({})).toBe(false);
    const denied = createRootKeyController({ api }); expect(await denied.preview({})).toBe(false); expect(await denied.importToken({})).toBe(false);
  });
});

it('serializes other-store writes and reads each map after the previous operation settles', async () => {
  const events: string[] = []; let release!: () => void;
  const rows = ['a','b'].map(id => ({ store: 'media-provider' as const, id, label: id, category: 'media' as const, configured: true, supportsReplace: true }));
  const api = createMemoryOtherCredentials({ rows }); const original = api.remove;
  api.remove = async (r, o) => { events.push(`start-${r.id}`); if (r.id === 'a') await new Promise<void>(r => { release = r; }); await original(r, o); events.push(`end-${r.id}`); };
  const c = createOtherCredentialsController({ api, permissions: ['security.read','admin.integrations.manage'] }); await c.load({});
  const first = c.remove({ row: rows[0]! }); const second = c.remove({ row: rows[1]! }); await Promise.resolve(); expect(events).toEqual(['start-a']); release(); await Promise.all([first, second]); expect(events).toEqual(['start-a','end-a','start-b','end-b']); expect(c.getSnapshot().rows).toEqual([]);
});
it('never starts destructive recovery after failed preview or against an active key', async () => {
  const api = createMemoryRootKey({ status: { active: false, source: 'none', state: 'missing-with-data', keyFilePath: '/key', runtimeMode: 'local' } }); api.previewStartFresh = () => Promise.reject(new Error('SECRET'));
  const start = vi.spyOn(api, 'startFresh'); const c = createRootKeyController({ api, permissions: ['admin.security.tokens.manage'] }); await c.load({}); expect(await c.preview({})).toBe(false); c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(false); expect(start).not.toHaveBeenCalled(); expect(c.getSnapshot().error).toBe('Recovery preview unavailable');
  c.setToken({ value: 'a'.repeat(64) }); await c.importToken({}); expect(await c.preview({})).toBe(false); expect(await c.generate({})).toBe(false);
});
