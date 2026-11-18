import { describe, expect, it } from 'vitest';
import type { SealedSecret } from '@jini-ai/core/contracts/vault';
import { createSealerStateCodec } from '../src/sealed-state-codec.js';

/** Fake AEAD: binds the plaintext to its AAD and refuses a different AAD on open. Counts opens. The ciphertext
 * carries the plaintext raw, so a plaintext with `?`/`>` puts bytes in the sealed JSON that spell `-`/`_` in base64url. */
function harness(aad = 'context-a') {
    const calls = { opens: 0, keys: [] as string[] };
    const sealer = {
        async seal({ plaintext, key, aad: bound }: { plaintext: string; key: { keyId: string }; aad: string }): Promise<SealedSecret> {
            calls.keys.push(key.keyId);
            return { keyId: key.keyId, alg: 'fake', ciphertext: plaintext, nonce: Buffer.from(bound, 'utf8').toString('base64') };
        },
        async open({ sealed }: { sealed: SealedSecret }, optional: { aad?: string } = {}): Promise<string> {
            calls.opens += 1;
            if (Buffer.from(sealed.nonce, 'base64').toString('utf8') !== optional.aad) throw new Error('authentication failed');
            return sealed.ciphertext;
        },
    };
    const keyring = { async activeKey() { return { keyId: 'key-1' }; } };
    return { calls, codec: createSealerStateCodec({ sealer, keyring, aad }) };
}

describe('createSealerStateCodec', () => {
    it('round-trips through the sealer under the active key as unpadded base64url', async () => {
        const { calls, codec } = harness();
        const state = await codec.seal({ plaintext: '{"exp":1}' });
        expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(calls.keys).toEqual(['key-1']);
        expect(await codec.open({ state })).toBe('{"exp":1}');
    });

    it('refuses to open a state sealed under another AAD', async () => {
        const state = await harness('context-a').codec.seal({ plaintext: 'secret' });
        await expect(harness('context-b').codec.open({ state })).rejects.toThrow();
    });

    for (const [name, change] of [
        ['padding appended', (s: string) => `${s}==`],
        ['a line break appended', (s: string) => `${s}\n`],
    ] as const) {
        it(`rejects a non-canonical state (${name}) as OAUTH_INVALID_STATE without opening it`, async () => {
            const { calls, codec } = harness();
            const state = await codec.seal({ plaintext: '{"exp":1}' });
            await expect(codec.open({ state: change(state) })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
            expect(calls.opens).toBe(0);
        });
    }

    it('rejects the standard-alphabet spelling of a state that contains - or _', async () => {
        const { calls, codec } = harness();
        let state = '';
        for (let i = 0; !/[-_]/.test(state); i += 1) state = await codec.seal({ plaintext: `{"n":${i},"pad":"???>>>"}` });
        const standard = state.replace(/-/g, '+').replace(/_/g, '/');
        await expect(codec.open({ state: standard })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
        expect(calls.opens).toBe(0);
    });
});
