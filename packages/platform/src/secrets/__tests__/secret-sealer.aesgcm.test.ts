import assert from "node:assert/strict";
import { test } from "vitest";
import { AesGcmSecretSealer, SECRET_OPEN_FAILED, SecretOpenError } from "../secret-sealer.aesgcm.js";
import { FixedRootKeyKeyring } from "../keyring.env.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { createCipheriv, randomBytes } from "node:crypto";
import type { KeyringPort, RootKeyHandle } from "@jini-ai/core/contracts/vault";
test("seal then open round-trips the plaintext exactly", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const activeKey = await keyring.activeKey({});
    const sealed = await sealer.seal({ plaintext: "not-a-real-credential-just-fixture-plaintext", key: activeKey, aad: "fixture-aad" });
    assert.equal(sealed.alg, "aes-256-gcm");
    assert.equal(sealed.keyId, activeKey.keyId);
    assert.notEqual(sealed.ciphertext, "not-a-real-credential-just-fixture-plaintext");
    const opened = await sealer.open({ sealed }, { aad: "fixture-aad" });
    assert.equal(opened, "not-a-real-credential-just-fixture-plaintext");
});
test("two seals of the same plaintext produce different ciphertext and nonce (fresh IV every call)", async () => {
    const sealer = new AesGcmSecretSealer({ keyring: new InMemoryKeyring({ hkdfSalt: "fixture-salt" }) });
    const activeKey = await (new InMemoryKeyring({ hkdfSalt: "fixture-salt" })).activeKey({});
    const first = await sealer.seal({ plaintext: "same-secret", key: activeKey, aad: "fixture-aad" });
    const second = await sealer.seal({ plaintext: "same-secret", key: activeKey, aad: "fixture-aad" });
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.notEqual(first.nonce, second.nonce);
});
test("a tampered ciphertext fails auth-tag verification rather than opening to garbage", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealer.seal({ plaintext: "sensitive-value", key: await keyring.activeKey({}), aad: "fixture-aad" });
    const tamperedBytes = Buffer.from(sealed.ciphertext, "base64");
    tamperedBytes[0] = tamperedBytes[0]! ^ 0xff;
    const tampered = { ...sealed, ciphertext: tamperedBytes.toString("base64") };
    await assert.rejects(() => sealer.open({ sealed: tampered }, { aad: "fixture-aad" }), /unable to authenticate data/);
});
test("a tampered nonce also fails — GCM authenticates against the exact IV used to seal", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealer.seal({ plaintext: "sensitive-value", key: await keyring.activeKey({}), aad: "fixture-aad" });
    const tamperedIv = Buffer.from(sealed.nonce, "base64");
    tamperedIv[0] = tamperedIv[0]! ^ 0xff;
    const tampered = { ...sealed, nonce: tamperedIv.toString("base64") };
    await assert.rejects(() => sealer.open({ sealed: tampered }, { aad: "fixture-aad" }), /unable to authenticate data/);
});
test("an unsupported alg is rejected before any key derivation", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    let deriveCalls = 0;
    keyring.derive = async () => {
        deriveCalls += 1;
        throw new Error("derive must not be reached for an unsupported algorithm");
    };
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    await assert.rejects(() => sealer.open({ sealed: { keyId: "v1", ciphertext: "AAAA", nonce: "AAAA", alg: "xchacha20poly1305" } }), /cannot open alg/);
    assert.equal(deriveCalls, 0);
});
test("backward compatibility: a value sealed with no aad still opens with no aad (existing rows keep working)", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await legacySeal(keyring, "legacy-row-value", await keyring.activeKey({}));
    const opened = await sealer.open({ sealed });
    assert.equal(opened, "legacy-row-value");
});
test("a value sealed with aad opens correctly when the SAME aad is supplied", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const aad = "ws-1:github-pages:cred-42";
    const sealed = await sealer.seal({ plaintext: "scoped-token", key: await keyring.activeKey({}), aad });
    const opened = await sealer.open({ sealed }, { aad });
    assert.equal(opened, "scoped-token");
});
test("a value sealed with aad A throws when opened with aad B (cross-tenant/cross-record transplant is rejected)", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealer.seal({ plaintext: "scoped-token", key: await keyring.activeKey({}), aad: "ws-1:github-pages:cred-42" });
    await assert.rejects(() => sealer.open({ sealed }, { aad: "ws-2:github-pages:cred-42" }));
});
test("a value sealed with aad A throws when opened with NO aad", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealer.seal({ plaintext: "scoped-token", key: await keyring.activeKey({}), aad: "ws-1:github-pages:cred-42" });
    await assert.rejects(() => sealer.open({ sealed }), { name: "SecretOpenError", code: SECRET_OPEN_FAILED, message: "Unsupported state or unable to authenticate data" });
});
test("a value sealed with NO aad throws when opened WITH an aad (asymmetry fails both directions)", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await legacySeal(keyring, "unscoped-token", await keyring.activeKey({}));
    await assert.rejects(() => sealer.open({ sealed }, { aad: "ws-1:github-pages:cred-42" }));
});
test("open() re-derives from the sealed row's own keyId, not the keyring's CURRENT active key", async () => {
    const generations = { v7: new InMemoryKeyring({ hkdfSalt: "fixture-salt" }, { keyId: "v7" }), v8: new InMemoryKeyring({ hkdfSalt: "fixture-salt" }, { keyId: "v8" }) };
    let activeKeyId: keyof typeof generations = "v7";
    const keyring: KeyringPort = {
        activeKey: async () => ({ keyId: activeKeyId }),
        deriveSigningSecret: generations.v7.deriveSigningSecret.bind(generations.v7),
        derive: async (input: {
            workspaceId: string;
            purpose: string;
            info: string;
        }) => {
            const generation = generations[input.info as keyof typeof generations];
            if (!generation)
                throw new Error(`unknown key generation: ${input.info}`);
            return generation.derive(input);
        },
    };
    const sealerA = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealerA.seal({ plaintext: "rotation-safe-value", key: await keyring.activeKey({}), aad: "fixture-aad" });
    activeKeyId = "v8";
    const sealerB = new AesGcmSecretSealer({ keyring: keyring });
    assert.equal(await sealerB.open({ sealed }, { aad: "fixture-aad" }), "rotation-safe-value");
    await assert.rejects(() => sealerB.open({ sealed: { ...sealed, keyId: "v8" } }, { aad: "fixture-aad" }), /unable to authenticate data/);
    await assert.rejects(() => sealerB.open({ sealed: { ...sealed, keyId: "unknown" } }, { aad: "fixture-aad" }), /unknown key generation/);
});
for (const aad of ["", "workspace-1:empty-verifier"]) {
    test(`empty plaintext round-trips with aad=${String(aad)}`, async () => {
        const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
        const sealer = new AesGcmSecretSealer({ keyring: keyring });
        const sealed = await sealer.seal({ plaintext: "", key: await keyring.activeKey({}), aad });
        assert.equal(Buffer.from(sealed.ciphertext, "base64").length, 16);
        assert.equal(await sealer.open({ sealed }, { aad }), "");
    });
}
test("ciphertext shorter than a complete authentication tag is rejected", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    const sealed = await sealer.seal({ plaintext: "", key: await keyring.activeKey({}), aad: "fixture-aad" });
    await assert.rejects(() => sealer.open({ sealed: { ...sealed, ciphertext: Buffer.alloc(15).toString("base64") } }), /ciphertext too short to contain an auth tag/);
});
// This helper creates real historical ciphertext; it does not bypass any public sealer operation.
async function legacySeal(keyring: KeyringPort, plaintext: string, key: RootKeyHandle, { iv = randomBytes(12) }: { iv?: Buffer } = {}) {
    const aesKey = await keyring.derive({ workspaceId: "secret-sealer", purpose: "secret-sealer.v1", info: key.keyId });
    const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
    return { keyId: key.keyId, alg: "aes-256-gcm", nonce: iv.toString("base64"),
        ciphertext: Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64") };
}
test("omitted seal AAD is zero AAD bytes: the same envelope as aad \"\" and as the historical unbound format", async () => {
    const keyring = new FixedRootKeyKeyring({ hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", hkdfSalt: "fixture-salt" }, {});
    const iv = Buffer.from("202122232425262728292a2b", "hex");
    const sealer = new AesGcmSecretSealer({ keyring }, { randomBytesFn: () => iv });
    const key = await keyring.activeKey();
    const omitted = await sealer.seal({ plaintext: "unbound-value", key });
    assert.deepEqual(omitted, await sealer.seal({ plaintext: "unbound-value", key, aad: "" }));
    assert.deepEqual(omitted, await legacySeal(keyring, "unbound-value", key, { iv }));
    assert.equal(await sealer.open({ sealed: omitted }), "unbound-value");
    await assert.rejects(() => sealer.open({ sealed: omitted }, { aad: "ws-1:row" }), SecretOpenError);
});
test("seal still refuses an AAD that is present but not a string", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealer = new AesGcmSecretSealer({ keyring: keyring });
    for (const aad of [null, 42, { row: "1" }]) {
        // @ts-expect-error JavaScript callers can pass a non-string; only an omitted AAD defaults.
        await assert.rejects(() => sealer.seal({ plaintext: "secret", key: { keyId: "v1" }, aad }), /aad must be a string/);
    }
});
test("every failure to open the sealed value itself carries SECRET_OPEN_FAILED (wrong key, tampered, damaged, unknown alg); its message is kept", async () => {
    // Two real, different root keys built at runtime: the runtime's own wording (OpenSSL in Node,
    // BoringSSL in Electron) never decides how a wrong key is classified, the code does.
    const sealedBy = new AesGcmSecretSealer({ keyring: new FixedRootKeyKeyring({ hex: randomBytes(32).toString("hex"), hkdfSalt: "fixture-salt" }, {}) });
    const openedBy = new AesGcmSecretSealer({ keyring: new FixedRootKeyKeyring({ hex: randomBytes(32).toString("hex"), hkdfSalt: "fixture-salt" }, {}) });
    const sealed = await sealedBy.seal({ plaintext: "fixture-value", key: { keyId: "v1" }, aad: "fixture-aad" });
    const wrongKey = await openedBy.open({ sealed }, { aad: "fixture-aad" }).catch((caught: unknown) => caught);
    assert.ok(wrongKey instanceof SecretOpenError);
    assert.equal(wrongKey.code, SECRET_OPEN_FAILED);
    assert.ok(wrongKey.cause instanceof Error, "the runtime's own error is kept as the cause");
    assert.equal(wrongKey.message, (wrongKey.cause as Error).message);
    const tampered = Buffer.from(sealed.ciphertext, "base64").map((byte, index) => index === 0 ? byte ^ 1 : byte);
    for (const damaged of [{ ...sealed, ciphertext: Buffer.from("short").toString("base64") }, { ...sealed, alg: "aes-128-cbc" },
        { ...sealed, ciphertext: Buffer.from(tampered).toString("base64") }, { ...sealed, nonce: "" }]) {
        await assert.rejects(sealedBy.open({ sealed: damaged }, { aad: "fixture-aad" }), (caught: unknown) => caught instanceof SecretOpenError && caught.code === SECRET_OPEN_FAILED);
    }
});
test("a keyring that can't derive (no key, an unusable key) is NOT an open failure: its error passes through as itself", async () => {
    const failure = new Error("no root key: none of the configured sources resolved");
    const keyring = new InMemoryKeyring({ hkdfSalt: "fixture-salt" });
    const sealed = await new AesGcmSecretSealer({ keyring }).seal({ plaintext: "fixture-value", key: await keyring.activeKey(), aad: "fixture-aad" });
    const broken = Object.assign(Object.create(keyring) as InMemoryKeyring, { derive: async () => { throw failure; } });
    await assert.rejects(new AesGcmSecretSealer({ keyring: broken }).open({ sealed }, { aad: "fixture-aad" }), (caught) => caught === failure);
});
test("SecretOpenError keeps a non-Error cause's text as its message", () => {
    const error = new SecretOpenError({ cause: "opaque failure" });
    assert.equal(error.message, "opaque failure");
    assert.equal(error.name, "SecretOpenError");
    assert.equal(error.cause, "opaque failure");
});
