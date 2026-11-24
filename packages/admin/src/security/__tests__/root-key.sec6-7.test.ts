import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMemoryRootKey } from '../adapters/memory.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import type { RootKeyPreview, RootKeyResult, RootKeyState, RootKeyStatus } from '../models.js';
import type { RootKeyPort } from '../ports.js';
// rv1123c FIX 1, SEC-6 (human-only reveal and clipboard) and SEC-7 (recovery parity), P9-SEC plan v2.
// Ports the reveal cases of the host's `use-site-key.unit.test.tsx` and the recovery cases of
// `use-site-key-recovery.unit.test.ts`. Every value below is a fixture.
const GRANT = ['admin.security.tokens.manage'];
const HEX = 'a3f9'.repeat(16);
const status = (state: RootKeyState, over: Partial<RootKeyStatus> = {}): RootKeyStatus => ({ active: false, source: 'none', state, keyFilePath: '/k', runtimeMode: 'local', ...over });
const ACTIVE = status('active', { active: true, source: 'file', fingerprint: 'fp' });
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const coded = (code: string, message = HEX) => Object.assign(new Error(message), { code, detail: `server echoed ${HEX}` });
const describeError = ({ error }: { error: unknown }) => { const e = error as { code?: string; detail?: string }; return { ...(e.code ? { code: e.code } : {}), ...(e.detail ? { detail: e.detail } : {}) }; };
async function revealing({ api = createMemoryRootKey({ status: ACTIVE, revealHex: HEX }), clipboard }: { api?: RootKeyPort; clipboard?: { writeText: (text: string) => Promise<void> } } = {}) {
  const c = createRootKeyController({ api, permissions: GRANT }, { describeError, ...(clipboard ? { clipboard } : {}) }); await c.load({}); return { api, c };
}
const noSecret = (value: unknown) => expect(JSON.stringify(value)).not.toContain(HEX);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('rv1123c FIX 1: a refusal never carries reader text', () => {
  it.each(['KEY_DEPENDENT_DATA', 'KEY_INVALID', 'ENV_VAR_ACTIVE'])('%s keeps only the code; the echoed detail is absent from the snapshot', async (code) => {
    const api = createMemoryRootKey({ status: status('missing') }); api.generate = () => Promise.reject(coded(code));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError }); await c.load({}); await c.generate({});
    noSecret(c.getSnapshot()); expect(c.getSnapshot().error).toBe('Root key could not be created.'); expect(c.getSnapshot().generateFailure).not.toHaveProperty('detail');
  });
  it('shows host-approved copy for a known code', async () => {
    const api = createMemoryRootKey({ status: status('missing') }); api.generate = () => Promise.reject(coded('KEY_INVALID'));
    const describeRefusal = vi.fn(({ code }: { code: string }) => (code === 'KEY_INVALID' ? 'The configured key is not valid.' : undefined));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError, describeRefusal }); await c.load({}); await c.generate({});
    expect(describeRefusal).toHaveBeenCalledWith({ code: 'KEY_INVALID' }); expect(c.getSnapshot()).toMatchObject({ generateFailure: { kind: 'refused', code: 'KEY_INVALID' }, error: 'The configured key is not valid.' });
  });
  it('a throwing or silent host describer falls back to fixed copy', async () => {
    for (const describeRefusal of [() => { throw new Error(HEX); }, () => undefined]) {
      const api = createMemoryRootKey({ status: status('missing') }); api.generate = () => Promise.reject(coded('KEY_INVALID'));
      const c = createRootKeyController({ api, permissions: GRANT }, { describeError, describeRefusal }); await c.load({}); await c.generate({});
      expect(c.getSnapshot().error).toBe('Root key could not be created.'); noSecret(c.getSnapshot());
    }
  });
});

describe('SEC-6 reveal', () => {
  it('reveals an active key into the private cell, never the snapshot', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {}), info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { api, c } = await revealing(); const spy = vi.spyOn(api, 'reveal' as never);
    expect(await c.reveal({})).toBe(true); expect(spy).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toMatchObject({ revealed: true, revealing: false, revealError: null }); expect(c.revealedValue({})).toBe(HEX);
    noSecret(c.getSnapshot()); noSecret([...log.mock.calls, ...warn.mock.calls, ...info.mock.calls]);
  });
  it('one POST per click: a second reveal while one is pending is refused', async () => {
    const api = createMemoryRootKey({ status: ACTIVE }); const gate = deferred<{ active: boolean; hex?: string }>(); const spy = vi.fn(() => gate.promise); api.reveal = spy;
    const { c } = await revealing({ api }); const first = c.reveal({}); expect(await c.reveal({})).toBe(false); expect(spy).toHaveBeenCalledTimes(1); gate.resolve({ active: true, hex: HEX }); await first;
  });
  it('does nothing without a reveal port, for an inactive key, or without the grant', async () => {
    const bare = createMemoryRootKey({ status: ACTIVE }); delete (bare as { reveal?: unknown }).reveal;
    expect(await (await revealing({ api: bare })).c.reveal({})).toBe(false);
    expect(await (await revealing({ api: createMemoryRootKey({ status: status('missing'), revealHex: HEX }) })).c.reveal({})).toBe(false);
    const api = createMemoryRootKey({ status: ACTIVE, revealHex: HEX }); const spy = vi.spyOn(api, 'reveal' as never);
    expect(await createRootKeyController({ api }).reveal({})).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
  it('an inactive reply, or one without hex, shows nothing and no error', async () => {
    for (const reply of [{ active: false, hex: HEX }, { active: true }]) {
      const api = createMemoryRootKey({ status: ACTIVE }); api.reveal = async () => reply; const { c } = await revealing({ api });
      expect(await c.reveal({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ revealed: false, revealError: null, revealing: false }); expect(c.revealedValue({})).toBeNull();
    }
  });
  it.each(['hide', 'load', 'write', 'dispose'] as const)('a reply that lands after %s is dropped', async (step) => {
    const api = createMemoryRootKey({ status: ACTIVE }); const gate = deferred<{ active: boolean; hex?: string }>(); api.reveal = () => gate.promise;
    const { c } = await revealing({ api }); const pending = c.reveal({});
    if (step === 'hide') c.hide({}); else if (step === 'load') await c.load({}); else if (step === 'dispose') c.dispose({});
    else { api.status = async () => status('mismatch'); await c.load({}); c.setToken({ value: 'b'.repeat(64) }); await c.importToken({}); }
    gate.resolve({ active: true, hex: HEX }); expect(await pending).toBe(false);
    expect(c.revealedValue({})).toBeNull(); expect(c.getSnapshot().revealed).toBe(false);
  });
  it('hide, reload and a successful write clear a shown value', async () => {
    const { c } = await revealing(); await c.reveal({}); c.hide({}); expect(c.revealedValue({})).toBeNull(); expect(c.getSnapshot().revealed).toBe(false);
    await c.reveal({}); await c.load({}); expect(c.revealedValue({})).toBeNull();
  });
  it('an error shows fixed or host copy and no value', async () => {
    const api = createMemoryRootKey({ status: ACTIVE }); api.reveal = () => Promise.reject(coded('KEY_INVALID')); const { c } = await revealing({ api });
    expect(await c.reveal({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ revealed: false, revealing: false, revealError: 'Root key could not be revealed.' }); noSecret(c.getSnapshot()); expect(c.revealedValue({})).toBeNull();
  });
  it('copies the value, shows copied for 1.5 s, and swallows a clipboard failure', async () => {
    vi.useFakeTimers(); const writeText = vi.fn(async (_text: string) => {}); const { c } = await revealing({ clipboard: { writeText } });
    expect(await c.copy({})).toBe(false); await c.reveal({}); expect(await c.copy({})).toBe(true); expect(writeText).toHaveBeenCalledWith(HEX);
    expect(c.getSnapshot().copied).toBe(true); vi.advanceTimersByTime(1499); expect(c.getSnapshot().copied).toBe(true); vi.advanceTimersByTime(1); expect(c.getSnapshot().copied).toBe(false);
    writeText.mockRejectedValueOnce(new Error('denied')); expect(await c.copy({})).toBe(false); expect(c.getSnapshot()).toMatchObject({ copied: false, revealError: null }); noSecret(c.getSnapshot());
  });
});

describe('SEC-7 recovery parity', () => {
  const hooks: RootKeyPreview = { removes: 2, detail: 'd', runtimeMode: 'local', affectedWebhooks: [{ label: 'Deploy', targetUrl: 'https://a' }] };
  it('a locked generate refusal unlocks recovery even when status looked clean', async () => {
    const api = createMemoryRootKey({ status: status('missing') }); api.generate = () => Promise.reject(coded('KEY_DEPENDENT_DATA'));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError }); await c.load({}); await c.generate({});
    const spy = vi.spyOn(api, 'importToken'); c.setToken({ value: ` ${'c'.repeat(64)} ` }); expect(await c.importToken({})).toBe(true); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('the unlock message carries the resealed count', async () => {
    const api = createMemoryRootKey({ status: status('mismatch') }); api.importToken = async () => ({ outcome: 'unlocked', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local', resealed: 3 } satisfies RootKeyResult);
    const t = vi.fn((key: string, vars: Record<string, string | number> = {}) => `${key}${vars.count === undefined ? '' : `:${vars.count}`}`);
    const c = createRootKeyController({ api, permissions: GRANT }, { t }); await c.load({}); c.setToken({ value: HEX }); await c.importToken({});
    expect(c.getSnapshot().result).toBe('rootKeyUnlocked rootKeyResealed:3');
  });
  it('a refusal whose message echoes the typed key never puts the key in error', async () => {
    const api = createMemoryRootKey({ status: status('mismatch') }); api.importToken = ({ token }) => Promise.reject(coded('KEY_MISMATCH', `bad key ${token}`));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError }); await c.load({}); c.setToken({ value: HEX }); await c.importToken({});
    expect(c.getSnapshot().error).toBe('Recovery refused. Check the host key configuration.'); expect(c.getSnapshot().error).not.toContain(HEX);
  });
  it('a refusal shows host-approved copy for its code', async () => {
    const api = createMemoryRootKey({ status: status('mismatch') }); api.importToken = () => Promise.reject(coded('KEY_MISMATCH'));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError, describeRefusal: ({ code }) => (code === 'KEY_MISMATCH' ? 'That is not the original key.' : undefined) });
    await c.load({}); c.setToken({ value: HEX }); await c.importToken({}); expect(c.getSnapshot().error).toBe('That is not the original key.');
  });
  async function failedPreview(previewRequired: boolean) {
    const api = createMemoryRootKey({ status: status('mismatch'), preview: hooks }); api.previewStartFresh = () => Promise.reject(coded('SITE_META_UNREADABLE'));
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError, previewRequired }); await c.load({}); expect(await c.preview({})).toBe(false); return { api, c };
  }
  it('previewRequired: false — a preview failure opens the confirm step with the error', async () => {
    const { c } = await failedPreview(false); expect(c.getSnapshot()).toMatchObject({ confirming: true, preview: null, error: 'Recovery preview unavailable', loading: false });
  });
  it.each([false, true])('previewRequired: %s — confirm is refused until the exact phrase', async (previewRequired) => {
    const api = createMemoryRootKey({ status: status('mismatch'), preview: hooks }); const c = createRootKeyController({ api, permissions: GRANT }, { previewRequired }); await c.load({}); await c.preview({});
    const spy = vi.spyOn(api, 'startFresh'); c.setConfirm({ value: 'START FRES' }); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled();
    c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(true); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('previewRequired: false — after a preview failure the exact phrase sends one start-fresh', async () => {
    const { api, c } = await failedPreview(false); const spy = vi.spyOn(api, 'startFresh');
    c.setConfirm({ value: 'start fresh' }); expect(await c.startFresh({})).toBe(false); c.setConfirm({ value: 'START FRESH' });
    expect(await c.startFresh({})).toBe(true); expect(spy).toHaveBeenCalledTimes(1); expect(spy).toHaveBeenCalledWith({ confirm: 'START FRESH' }, { signal: expect.any(AbortSignal) });
    expect(c.getSnapshot().result).toBe('Done. Re-enter removed credentials. Update receivers: Deploy (https://a)');
  });
  it('previewRequired: true — a preview failure keeps the confirm step closed', async () => {
    const { api, c } = await failedPreview(true); expect(c.getSnapshot()).toMatchObject({ confirming: false, error: 'Recovery preview unavailable' });
    const spy = vi.spyOn(api, 'startFresh'); c.setConfirm({ value: 'START FRESH' }); expect(await c.startFresh({})).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
});
