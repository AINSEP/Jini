import assert from "node:assert/strict";
import { test } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { FixedRootKeyKeyring } from "../keyring.env.js";
// The salt is a public wire fixture encoded as bytes, not a package default.
const hkdfSalt = Buffer.from("746f76752d696e746567726174696f6e732d726f6f742d6b65792d686b64662d7631", "hex");
const aad = "vendor-credential-set:v1:ws-1:github:cred-1";
const plaintext = "not-a-real-credential-just-fixture-plaintext";
const fixture = {
    keyId: "v1",
    ciphertext: "k4x3HnV2IOA/glDbtHXFOSSNNCvrDhyEngtsVHk+d8v4SbXwzfbClqF6LkOS7SXtV6YeiM9IV03tS9H9",
    nonce: "ICEiIyQlJicoKSor",
    alg: "aes-256-gcm",
};
test("sealing bytes equal the pinned pre-extraction fixture", async () => {
    const keyring = new FixedRootKeyKeyring({ hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", hkdfSalt }, {});
    const sealer = new AesGcmSecretSealer({ keyring: keyring }, { randomBytesFn: ({ byteLength }) => {
        assert.equal(byteLength, 12);
        return Buffer.from("202122232425262728292a2b", "hex");
    } });
    assert.deepEqual(await sealer.seal({ plaintext, key: await keyring.activeKey({}), aad }), fixture);
});
test("opens the fixed stored ciphertext with the caller-supplied salt and AAD", async () => {
    const keyring = new FixedRootKeyKeyring({ hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", hkdfSalt }, {});
    assert.equal(await new AesGcmSecretSealer({ keyring: keyring }).open({ sealed: fixture }, { aad }), plaintext);
});
test("an injected random source cannot change the 12-byte IV wire contract", async () => {
    const keyring = new FixedRootKeyKeyring({ hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", hkdfSalt }, {});
    for (const byteLength of [0, 11, 13]) {
        const sealer = new AesGcmSecretSealer({ keyring }, { randomBytesFn: () => new Uint8Array(byteLength) });
        await assert.rejects(() => sealer.seal({ plaintext, key: { keyId: "v1" }, aad }),
            { name: "TypeError", message: "AesGcmSecretSealer: IV must contain exactly 12 bytes" });
    }
});
