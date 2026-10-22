import { describe, it, expect, vi } from 'vitest';
import { createMemoryRootKey } from '../adapters/memory.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import type { RootKeyPreview, RootKeyResult, RootKeyState, RootKeyStatus } from '../models.js';
const GRANT = ['admin.security.tokens.manage'];
const HEX = 'ab'.repeat(32);
const status = (state: RootKeyState, over: Partial<RootKeyStatus> = {}): RootKeyStatus => ({ active: false, source: 'none', state, keyFilePath: '/k', runtimeMode: 'local', ...over });
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function setup({ state = 'missing' as RootKeyState, permissions = GRANT, preview }: { state?: RootKeyState; permissions?: string[]; preview?: RootKeyPreview } = {}) {
  const api = createMemoryRootKey({ status: status(state), ...(preview ? { preview } : {}) }); const c = createRootKeyController({ api, permissions }); await c.load({}); return { api, c };
}
async function previewed(over: { preview?: RootKeyPreview } = {}) { const s = await setup({ state: 'mismatch', ...over }); expect(await s.c.preview({})).toBe(true); return s; }
describe('root key controller: load', () => {
  it('does not read without the grant', async () => { const api = createMemoryRootKey({}); const spy = vi.spyOn(api, 'status'); await createRootKeyController({ api }).load({}); expect(spy).not.toHaveBeenCalled(); });
  it('loads the status', async () => { const { c } = await setup(); expect(c.getSnapshot()).toMatchObject({ status: status('missing'), loading: false, error: null }); });
  it('reports an unavailable status without the cause', async () => { const api = createMemoryRootKey({}); api.status = () => Promise.reject(new Error('PRIVATE')); const c = createRootKeyController({ api, permissions: GRANT }); await c.load({}); expect(c.getSnapshot()).toMatchObject({ error: 'Root key status unavailable', loading: false }); });
  it('ignores a superseded status read', async () => {
    const api = createMemoryRootKey({}); const late = deferred<RootKeyStatus>(); let n = 0; const real = api.status; api.status = (r, o) => (++n === 1 ? late.promise : real(r, o));
    const c = createRootKeyController({ api, permissions: GRANT }); const stale = c.load({}); await c.load({}); late.resolve(status('mismatch')); await stale; expect(c.getSnapshot()).toMatchObject({ status: { state: 'missing' }, loading: false });
  });
  it('ignores a superseded status failure', async () => {
    const api = createMemoryRootKey({}); const late = deferred<RootKeyStatus>(); let n = 0; const real = api.status; api.status = (r, o) => (++n === 1 ? late.promise : real(r, o));
    const c = createRootKeyController({ api, permissions: GRANT }); const stale = c.load({}); await c.load({}); late.reject(new Error('x')); await stale; expect(c.getSnapshot().error).toBeNull();
  });
});
describe('root key controller: generate', () => {
  it('creates a missing key and reports it ready', async () => { const { c } = await setup(); expect(await c.generate({})).toBe(true); expect(c.getSnapshot()).toMatchObject({ result: 'Root key ready', saving: false, status: { active: true } }); });
  it('refuses before status is known', async () => { const api = createMemoryRootKey({}); const spy = vi.spyOn(api, 'generate'); expect(await createRootKeyController({ api, permissions: GRANT }).generate({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses to replace an active key', async () => { const api = createMemoryRootKey({ status: status('missing', { active: true }) }); const spy = vi.spyOn(api, 'generate'); const c = createRootKeyController({ api, permissions: GRANT }); await c.load({}); expect(await c.generate({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses when data depends on a missing key', async () => { const { api, c } = await setup({ state: 'missing-with-data' }); const spy = vi.spyOn(api, 'generate'); expect(await c.generate({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('reports a refused generation with the fixed message', async () => { const { api, c } = await setup(); api.generate = () => Promise.reject(new Error('PRIVATE')); expect(await c.generate({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ error: 'Recovery refused. Check the host key configuration.', saving: false }); });
  it('refuses without the grant', async () => { const api = createMemoryRootKey({}); const spy = vi.spyOn(api, 'generate'); const c = createRootKeyController({ api }); expect(await c.generate({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('returns false when disposed during the write', async () => { const { api, c } = await setup(); const gate = deferred<RootKeyResult>(); api.generate = () => gate.promise; const pending = c.generate({}); c.dispose({}); gate.resolve({ outcome: 'created', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local' }); expect(await pending).toBe(false); });
  it('refuses a second write while one is pending', async () => {
    const { api, c } = await setup(); const gate = deferred<RootKeyResult>(); const spy = vi.fn(() => gate.promise); api.generate = spy; const first = c.generate({});
    expect(await c.generate({})).toBe(false); expect(spy).toHaveBeenCalledTimes(1); gate.reject(new Error('x')); await first;
  });
});
describe('root key controller: unlock', () => {
  it('unlocks a locked key with the trimmed token and clears it', async () => {
    const { api, c } = await setup({ state: 'missing-with-data' }); const spy = vi.spyOn(api, 'importToken'); c.setToken({ value: ` ${HEX} ` });
    expect(await c.importToken({})).toBe(true); expect(spy).toHaveBeenCalledWith({ token: HEX }, { signal: expect.any(AbortSignal) }); expect(c.getSnapshot()).toMatchObject({ token: '', result: 'Unlocked. Saved credentials work again.' });
  });
  it('refuses a blank token', async () => { const { api, c } = await setup({ state: 'mismatch' }); const spy = vi.spyOn(api, 'importToken'); c.setToken({ value: '   ' }); expect(await c.importToken({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses when the key is not locked', async () => { const { api, c } = await setup(); const spy = vi.spyOn(api, 'importToken'); c.setToken({ value: HEX }); expect(await c.importToken({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('keeps the pasted token after a refused unlock', async () => { const { c } = await setup({ state: 'mismatch' }); c.setToken({ value: 'bad' }); expect(await c.importToken({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ token: 'bad', error: 'Recovery refused. Check the host key configuration.' }); });
  it('ignores token and confirmation input without the grant', async () => { const c = createRootKeyController({ api: createMemoryRootKey({}) }); c.setToken({ value: 'x' }); c.setConfirm({ value: 'y' }); expect(c.getSnapshot()).toMatchObject({ token: '', confirm: '' }); });
  it('ignores token and confirmation input while saving', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyResult>(); api.importToken = () => gate.promise; c.setToken({ value: 'first' }); const pending = c.importToken({});
    c.setToken({ value: 'second' }); c.setConfirm({ value: 'y' }); expect(c.getSnapshot()).toMatchObject({ token: 'first', confirm: '' }); gate.reject(new Error('x')); await pending;
  });
});
describe('root key controller: start fresh', () => {
  const hooks: RootKeyPreview = { removes: 2, detail: 'd', runtimeMode: 'local', affectedWebhooks: [{ label: 'Deploy', targetUrl: 'https://a' }, { label: 'Chat', targetUrl: 'https://b' }] };
  it('previews a locked key and enters confirmation', async () => { const { c } = await previewed(); expect(c.getSnapshot()).toMatchObject({ confirming: true, loading: false, confirm: '', error: null, preview: { removes: 0 } }); });
  it('refuses a preview without the grant', async () => { const c = createRootKeyController({ api: createMemoryRootKey({ status: status('mismatch') }) }); expect(await c.preview({})).toBe(false); });
  it('refuses a preview when the key is not locked', async () => { const { api, c } = await setup(); const spy = vi.spyOn(api, 'previewStartFresh'); expect(await c.preview({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses a preview while loading', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyStatus>(); api.status = () => gate.promise; const loading = c.load({});
    const spy = vi.spyOn(api, 'previewStartFresh'); expect(await c.preview({})).toBe(false); expect(spy).not.toHaveBeenCalled(); gate.resolve(status('mismatch')); await loading;
  });
  it('refuses a preview while saving', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyResult>(); api.importToken = () => gate.promise; c.setToken({ value: HEX }); const pending = c.importToken({});
    const spy = vi.spyOn(api, 'previewStartFresh'); expect(await c.preview({})).toBe(false); expect(spy).not.toHaveBeenCalled(); gate.reject(new Error('x')); await pending;
  });
  it('drops a preview cancelled while in flight', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyPreview>(); api.previewStartFresh = () => gate.promise; const pending = c.preview({});
    c.cancel({}); gate.resolve(hooks); expect(await pending).toBe(false); expect(c.getSnapshot()).toMatchObject({ preview: null, confirming: false, loading: false });
  });
  it('ignores a failure of a cancelled preview', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyPreview>(); api.previewStartFresh = () => gate.promise; const pending = c.preview({});
    c.cancel({}); gate.reject(new Error('x')); expect(await pending).toBe(false); expect(c.getSnapshot().error).toBeNull();
  });
  it('drops a preview that lands after disposal', async () => {
    const { api, c } = await setup({ state: 'mismatch' }); const gate = deferred<RootKeyPreview>(); api.previewStartFresh = () => gate.promise; const pending = c.preview({});
    c.dispose({}); gate.resolve(hooks); expect(await pending).toBe(false);
  });
  it('starts fresh with the typed confirmation and lists receivers to update', async () => {
    const { api, c } = await previewed({ preview: hooks }); const spy = vi.spyOn(api, 'startFresh'); c.setConfirm({ value: 'START FRESH' });
    expect(await c.startFresh({})).toBe(true); expect(spy).toHaveBeenCalledWith({ confirm: 'START FRESH' }, { signal: expect.any(AbortSignal) });
    expect(c.getSnapshot()).toMatchObject({ result: 'Done. Re-enter removed credentials. Update receivers: Deploy (https://a), Chat (https://b)', preview: null, confirming: false, confirm: '' });
  });
  it('reports a plain result when no receiver is affected', async () => { const { c } = await previewed(); c.setConfirm({ value: 'START FRESH' }); await c.startFresh({}); expect(c.getSnapshot().result).toBe('Done. Re-enter removed credentials.'); });
  it('refuses a near-miss confirmation', async () => { const { api, c } = await previewed(); const spy = vi.spyOn(api, 'startFresh'); c.setConfirm({ value: 'start fresh' }); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses after the confirmation was cancelled', async () => { const { api, c } = await previewed(); c.cancel({}); const spy = vi.spyOn(api, 'startFresh'); c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled(); });
  it('refuses once the key is no longer locked', async () => {
    const { api, c } = await previewed(); c.setToken({ value: HEX }); c.setConfirm({ value: 'START FRESH' }); await c.importToken({}); expect(c.getSnapshot().status?.state).toBe('active');
    const spy = vi.spyOn(api, 'startFresh'); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
  it('refuses while confirming without a loaded preview', async () => {
    const { api, c } = await previewed(); const gate = deferred<RootKeyPreview>(); api.previewStartFresh = () => gate.promise; const again = c.preview({}); c.setConfirm({ value: 'START FRESH' });
    const spy = vi.spyOn(api, 'startFresh'); expect(c.getSnapshot()).toMatchObject({ confirming: true, preview: null }); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled(); gate.resolve(hooks); await again;
  });
  it('reports a refused start fresh and keeps the confirmation open', async () => { const { api, c } = await previewed(); api.startFresh = () => Promise.reject(new Error('PRIVATE')); c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ error: 'Recovery refused. Check the host key configuration.', confirming: true, confirm: 'START FRESH' }); });
  it('does not cancel while saving', async () => {
    const { api, c } = await previewed(); const gate = deferred<RootKeyResult>(); api.startFresh = () => gate.promise; c.setConfirm({ value: 'START FRESH' }); const pending = c.startFresh({});
    c.cancel({}); expect(c.getSnapshot().confirming).toBe(true); gate.reject(new Error('x')); await pending;
  });
});
