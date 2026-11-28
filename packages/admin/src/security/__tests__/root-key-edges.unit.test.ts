import { describe, expect, it, vi } from 'vitest';
import { createMemoryRootKey } from '../adapters/memory.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import type { RootKeyResult, RootKeyStatus } from '../models.js';

const GRANT = ['admin.security.tokens.manage'];
const HEX = 'cd'.repeat(32);
const status = (over: Partial<RootKeyStatus>): RootKeyStatus => ({ active: false, source: 'none', state: 'mismatch', keyFilePath: '/k', runtimeMode: 'local', ...over });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe('root key unlock message (SEC-6)', () => {
  it('reads a reply without a resealed count as nothing moved over', async () => {
    const api = createMemoryRootKey({ status: status({}) });
    api.importToken = async () => ({ outcome: 'unlocked', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local' } satisfies RootKeyResult);
    const c = createRootKeyController({ api, permissions: GRANT }); await c.load({});
    c.setToken({ value: HEX });
    expect(await c.importToken({})).toBe(true);
    expect(c.getSnapshot().result).toBe('Unlocked. Saved credentials work again.');
  });
});

describe('root key refusal copy (SEC-7)', () => {
  it('shows the fixed refusal when the host describer throws, never the raw error', async () => {
    const api = createMemoryRootKey({ status: status({}) });
    api.importToken = async () => { throw new Error('server echoed fixture-detail'); };
    const describeError = vi.fn(() => { throw new Error('describer broke'); });
    const describeRefusal = vi.fn(() => 'Host refusal copy');
    const c = createRootKeyController({ api, permissions: GRANT }, { describeError, describeRefusal }); await c.load({});
    c.setToken({ value: HEX });
    expect(await c.importToken({})).toBe(false);
    expect(describeError).toHaveBeenCalled();
    // No code was described, so the host's refusal copy is never consulted.
    expect(describeRefusal).not.toHaveBeenCalled();
    expect(c.getSnapshot().error).toBe('Recovery refused. Check the host key configuration.');
    expect(JSON.stringify(c.getSnapshot())).not.toContain('fixture-detail');
  });
});

describe('root key copy (SEC-7)', () => {
  it('a copy that lands after the key was hidden does not report "Copied"', async () => {
    const write = deferred<void>();
    const clipboard = { writeText: vi.fn(() => write.promise) };
    const api = createMemoryRootKey({ status: status({ active: true, state: 'active' }), revealHex: HEX });
    const c = createRootKeyController({ api, permissions: GRANT }, { clipboard }); await c.load({});
    expect(await c.reveal({})).toBe(true);
    const copying = c.copy({});
    expect(clipboard.writeText).toHaveBeenCalledWith(HEX);
    c.hide({});
    write.resolve();
    expect(await copying).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ copied: false, revealed: false });
    expect(c.revealedValue({})).toBeNull();
  });
});
