import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { EnvOrFileKeyring, FixedRootKeyKeyring, fingerprintRootKeyHex, generateFileRootKey, inspectRootKeyMaterial as inspectKeyMaterial, revealRootKeyMaterial as revealKeyMaterial, RootKeyFileAlreadyExistsError, UnusableRootKeyError, } from "../keyring.env.js";
const ENV_VAR = "PLATFORM_TEST_INTEGRATIONS_ROOT_KEY";
async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "platform-keyring-test-"));
    try {
        return await fn(dir);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
test("env-var override supplies the root key", async () => {
    const original = process.env[ENV_VAR];
    process.env[ENV_VAR] = "aa".repeat(32);
    try {
        const keyring = new TestKeyring({
            envVarName: ENV_VAR,
            keyFilePath: "/should/never/be/touched",
        });
        const secret = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        assert.equal(secret.length, 32);
        assert.equal(Buffer.from(secret).toString("hex"), "8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
        await withTempDir(async (dir) => {
            const keyFilePath = join(dir, "root-key.hex");
            writeFileSync(keyFilePath, "aa".repeat(32), { mode: 0o600 });
            const fileKeyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VECTOR", keyFilePath, allowFileAutoGenerate: false });
            assert.deepEqual(await fileKeyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 }), secret);
        });
    }
    finally {
        if (original === undefined)
            delete process.env[ENV_VAR];
        else
            process.env[ENV_VAR] = original;
    }
});
test("generated-file fallback creates a key outside the caller-specified path only once", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "nested", "root-key.hex");
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR", keyFilePath });
        const first = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        const second = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        assert.deepEqual(first, second);
        const rehydrated = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR", keyFilePath });
        const third = await rehydrated.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        assert.deepEqual(first, third);
    });
});
test("HKDF determinism: same input yields same output; different inputs diverge", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR_2", keyFilePath });
        const base = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        const sameAgain = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 1,
        });
        const differentVersion = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-1",
            version: 2,
        });
        const differentSubscription = await keyring.deriveSigningSecret({
            workspaceId: "ws-1",
            subscriptionId: "sub-2",
            version: 1,
        });
        const differentWorkspace = await keyring.deriveSigningSecret({
            workspaceId: "ws-2",
            subscriptionId: "sub-1",
            version: 1,
        });
        const differentPurpose = await keyring.derive({
            workspaceId: "ws-1",
            purpose: "analytics-salt",
            info: "2026-01-01",
        });
        assert.deepEqual(base, sameAgain);
        assert.notDeepEqual(base, differentVersion);
        assert.notDeepEqual(base, differentSubscription);
        assert.notDeepEqual(base, differentWorkspace);
        assert.notDeepEqual(base, differentPurpose);
        const genericInput = { workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" };
        const genericBase = await keyring.derive(genericInput);
        for (const changed of [{ workspaceId: "ws-2" }, { purpose: "analytics-salt" }, { info: "v2" }]) {
            assert.notDeepEqual(genericBase, await keyring.derive({ ...genericInput, ...changed }));
        }
    });
});
test("HKDF known answers preserve signing and secret-sealer key compatibility", async () => {
    const keyring = new FixedRootKeyKeyring({ hex: "aa".repeat(32), hkdfSalt }, {});
    const signing = await keyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 });
    assert.equal(Buffer.from(signing).toString("hex"), "8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
    const input = { workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" };
    const expected = "14d4c938fdcabf1565bfabc9548975ab030e2494577dae057b35df76eb6abef8";
    assert.equal(Buffer.from(await keyring.derive(input)).toString("hex"), expected);
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        writeFileSync(keyFilePath, "aa".repeat(32), { mode: 0o600 });
        const installed = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VECTOR", keyFilePath });
        assert.equal(Buffer.from(await installed.derive(input)).toString("hex"), expected);
    });
});
test("missing root key throws and never returns a placeholder secret", async () => {
    const keyring = new TestKeyring({
        envVarName: "PLATFORM_TEST_DEFINITELY_UNSET_VAR",
        allowFileFallback: false,
    });
    await assert.rejects(() => keyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 }), /no root key/);
});
test("activeKey returns default keyId or configured keyId", async () => {
    const defaultKeyring = new TestKeyring();
    const defaultActive = await defaultKeyring.activeKey({});
    assert.equal(defaultActive.keyId, "v1");
    const customKeyring = new TestKeyring({ keyId: "v2-custom" });
    const customActive = await customKeyring.activeKey({});
    assert.equal(customActive.keyId, "v2-custom");
});
test("invalid hex-encoded env var throws error", async () => {
    const original = process.env[ENV_VAR];
    try {
        process.env[ENV_VAR] = "not-hex-chars-at-all!!";
        const keyring1 = new TestKeyring({ envVarName: ENV_VAR, allowFileFallback: false });
        await assert.rejects(() => keyring1.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 }), {
            name: "UnusableRootKeyError",
            message: 'PLATFORM_TEST_INTEGRATIONS_ROOT_KEY is not usable as a root key: it contains characters that are not hex digits (only 0-9 and a-f are allowed; a "0x" prefix, whitespace inside the value, or a base64 or PEM body all fail this). The keyring refuses to derive any key material from it rather than sealing under a shortened or empty key.',
        });
        process.env[ENV_VAR] = "abc";
        const keyring2 = new TestKeyring({ envVarName: ENV_VAR, allowFileFallback: false });
        await assert.rejects(() => keyring2.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 }), {
            name: "UnusableRootKeyError",
            message: "PLATFORM_TEST_INTEGRATIONS_ROOT_KEY is not usable as a root key: it has an odd number of hex digits (3), so it does not describe whole bytes — usually a partial write or a truncated copy. The keyring refuses to derive any key material from it rather than sealing under a shortened or empty key.",
        });
    }
    finally {
        if (original === undefined)
            delete process.env[ENV_VAR];
        else
            process.env[ENV_VAR] = original;
    }
});
test("allowFileAutoGenerate: false throws rather than minting a file, when neither env var nor file exists", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR_AUTOGEN", keyFilePath, allowFileFallback: true, allowFileAutoGenerate: false });
        await assert.rejects(() => keyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 }), /does not auto-generate one/);
        assert.equal(existsSync(keyFilePath), false, "must never create the file as a side effect of a refused resolve");
    });
});
test("allowFileAutoGenerate: false still READS a file an explicit generateFileRootKey already created", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const generated = generateFileRootKey({ keyFilePath });
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR_AUTOGEN_2", keyFilePath, allowFileFallback: true, allowFileAutoGenerate: false });
        const secret = await keyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 });
        assert.equal(secret.length, 32);
        assert.equal(readFileSync(keyFilePath, "utf8").trim(), generated.hex);
    });
});
test("characterization host explicitly preserves legacy fallback and generation defaults", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "nested", "root-key.hex");
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR_AUTOGEN_3", keyFilePath });
        const secret = await keyring.deriveSigningSecret({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 });
        assert.equal(secret.length, 32);
        assert.equal(existsSync(keyFilePath), true);
    });
});
test("generateFileRootKey writes a fresh 32-byte key and returns its hex/fingerprint/path", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const result = generateFileRootKey({ keyFilePath });
        assert.equal(result.keyFilePath, keyFilePath);
        assert.equal(result.hex.length, 64, "32 bytes, hex-encoded, is 64 characters");
        assert.match(result.hex, /^[0-9a-f]{64}$/);
        assert.equal(result.fingerprint.length, 12);
        assert.equal(result.fingerprint, createHash("sha256").update(Buffer.from(result.hex, "hex")).digest("hex").slice(0, 12));
        assert.equal(readFileSync(keyFilePath, "utf8").trim(), result.hex);
    });
});
test("fingerprintRootKeyHex preserves the SHA-256 stamp of decoded root-key bytes", () => {
    assert.equal(fingerprintRootKeyHex({ hex: "aa".repeat(32) }), "e0e77a507412");
});
test("generateFileRootKey throws RootKeyFileAlreadyExistsError, and never overwrites, when a file is already there", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const first = generateFileRootKey({ keyFilePath });
        assert.throws(() => generateFileRootKey({ keyFilePath }), RootKeyFileAlreadyExistsError);
        assert.equal(readFileSync(keyFilePath, "utf8").trim(), first.hex);
    });
});
test("generateFileRootKey refuses a target it did not create, even one existsSync() reports as absent", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const linkTarget = join(dir, "somewhere-else.hex");
        symlinkSync(linkTarget, keyFilePath);
        assert.equal(existsSync(keyFilePath), false, "precondition: a dangling symlink reads as absent");
        assert.throws(() => generateFileRootKey({ keyFilePath }), RootKeyFileAlreadyExistsError);
        assert.equal(existsSync(linkTarget), false, "the key must not have been written through the link");
    });
});
test("inspectRootKeyMaterial: none active when neither env var nor file resolves", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const status = inspectRootKeyMaterial({ envVarName: "PLATFORM_TEST_UNSET_VAR_INSPECT_1", keyFilePath });
        assert.deepEqual(status, { active: false, source: "none", keyFilePath });
    });
});
test("inspectRootKeyMaterial: active via env var, with a fingerprint, and NEVER the raw value", async () => {
    const envVarName = "PLATFORM_TEST_INSPECT_ENV";
    process.env[envVarName] = "bb".repeat(32);
    try {
        const status = inspectRootKeyMaterial({ envVarName, keyFilePath: "/should/never/be/touched" });
        assert.equal(status.active, true);
        assert.equal(status.source, "env");
        assert.equal(status.fingerprint?.length, 12);
        assert.equal((status as {
            hex?: string;
        }).hex, undefined, "status must never carry the raw key value");
    }
    finally {
        delete process.env[envVarName];
    }
});
test("inspectRootKeyMaterial: active via file when the env var is unset", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const generated = generateFileRootKey({ keyFilePath });
        const status = inspectRootKeyMaterial({ envVarName: "PLATFORM_TEST_UNSET_VAR_INSPECT_2", keyFilePath });
        assert.equal(status.active, true);
        assert.equal(status.source, "file");
        assert.equal(status.fingerprint, generated.fingerprint);
    });
});
test("inspectRootKeyMaterial: invalid hex in the env var reports invalid, not active, and no fingerprint", async () => {
    const envVarName = "PLATFORM_TEST_INSPECT_INVALID";
    process.env[envVarName] = "not-valid-hex!!";
    try {
        const status = inspectRootKeyMaterial({ envVarName, keyFilePath: "/should/never/be/touched" });
        assert.equal(status.active, false);
        assert.equal(status.source, "env");
        assert.equal(status.invalid, true);
        assert.equal(status.fingerprint, undefined);
    }
    finally {
        delete process.env[envVarName];
    }
});
test("revealRootKeyMaterial: includes the raw hex value when active — the one function in this pair that can", async () => {
    const envVarName = "PLATFORM_TEST_REVEAL_ENV";
    const value = "cc".repeat(32);
    process.env[envVarName] = value;
    try {
        const reveal = revealRootKeyMaterial({ envVarName, keyFilePath: "/should/never/be/touched" });
        assert.equal(reveal.active, true);
        assert.equal(reveal.hex, value);
    }
    finally {
        delete process.env[envVarName];
    }
});
test("revealRootKeyMaterial: no hex field when nothing is active", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        const reveal = revealRootKeyMaterial({ envVarName: "PLATFORM_TEST_UNSET_VAR_REVEAL", keyFilePath });
        assert.equal(reveal.active, false);
        assert.equal(reveal.hex, undefined);
    });
});
const MALFORMED_KEY_FILE_CONTENTS: ReadonlyArray<{
    label: string;
    contents: string;
    reason: RegExp;
}> = [
    { label: "a pasted 0x prefix", contents: `0x${"ab".repeat(32)}`, reason: /not hex digits/ },
    { label: "wholly non-hex content", contents: "not-hex-at-all", reason: /not hex digits/ },
    { label: "a base64 body someone pasted instead of hex", contents: "c2VjcmV0LXJvb3Qta2V5", reason: /not hex digits/ },
    { label: "an odd number of hex digits (a partial write)", contents: "ab".repeat(31) + "c", reason: /odd number of hex digits/ },
    { label: "a truncated copy", contents: "ab".repeat(8), reason: /at least 32 bytes/ },
    { label: "an empty file", contents: "", reason: /empty/ },
];
for (const { label, contents, reason } of MALFORMED_KEY_FILE_CONTENTS) {
    test(`resolveRootKey REFUSES a key file containing ${label} — it never seals under truncated bytes`, async () => {
        await withTempDir(async (dir) => {
            const keyFilePath = join(dir, "root-key.hex");
            writeFileSync(keyFilePath, contents, { mode: 0o600 });
            const keyring = new TestKeyring({
                envVarName: "PLATFORM_TEST_UNSET_VAR_MALFORMED_FILE",
                keyFilePath,
                allowFileFallback: true,
                allowFileAutoGenerate: false,
            });
            await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" }), reason, `a key file containing ${label} must not produce usable key material`);
            assert.equal(readFileSync(keyFilePath, "utf8"), contents, "a refused resolve must never rewrite the key file");
        });
    });
}
test("a non-hex key file is refused with a typed UnusableRootKeyError, not collapsed to the publicly computable zero-length-IKM key", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        writeFileSync(keyFilePath, "not-hex-at-all", { mode: 0o600 });
        const keyring = new TestKeyring({
            envVarName: "PLATFORM_TEST_UNSET_VAR_ZERO_IKM",
            keyFilePath,
            allowFileFallback: true,
            allowFileAutoGenerate: false,
        });
        await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" }), (err: unknown) => {
            assert.ok(err instanceof UnusableRootKeyError);
            assert.equal(err.source, "file");
            assert.equal(err.reason, "not-hex");
            return true;
        });
    });
});
test("the status screen and the sealer cannot disagree: whatever inspectRootKeyMaterial calls unusable, resolveRootKey refuses", async () => {
    await withTempDir(async (dir) => {
        const envVarName = "PLATFORM_TEST_UNSET_VAR_AGREEMENT";
        const keyFilePath = join(dir, "root-key.hex");
        for (const { contents } of MALFORMED_KEY_FILE_CONTENTS) {
            writeFileSync(keyFilePath, contents, { mode: 0o600 });
            const status = inspectRootKeyMaterial({ envVarName, keyFilePath });
            assert.equal(status.active, false, `inspect must report ${JSON.stringify(contents)} unusable`);
            const keyring = new TestKeyring({ envVarName, keyFilePath, allowFileFallback: true, allowFileAutoGenerate: false });
            await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" }), `resolveRootKey must refuse the same material inspect reports unusable: ${JSON.stringify(contents)}`);
        }
    });
});
test("a hex key shorter than 32 bytes is unusable through BOTH paths — a short env var is not a root key either", async () => {
    const envVarName = "PLATFORM_TEST_SHORT_ENV_KEY";
    process.env[envVarName] = "ab".repeat(16); // 16 bytes: valid hex, even length, still too short.
    try {
        const status = inspectRootKeyMaterial({ envVarName, keyFilePath: "/should/never/be/touched" });
        assert.equal(status.active, false);
        assert.equal(status.invalid, true);
        const keyring = new TestKeyring({ envVarName, allowFileFallback: false });
        await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" }), /at least 32 bytes/);
    }
    finally {
        delete process.env[envVarName];
    }
});
test("the malformed-key-file error names the file, says what is wrong, and does NOT imply replacing it restores anything", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        writeFileSync(keyFilePath, `0x${"ab".repeat(32)}`, { mode: 0o600 });
        const keyring = new TestKeyring({
            envVarName: "PLATFORM_TEST_UNSET_VAR_MESSAGE",
            keyFilePath,
            allowFileFallback: true,
            allowFileAutoGenerate: false,
        });
        await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" }), {
            name: "UnusableRootKeyError",
            source: "file",
            reason: "not-hex",
            message: `the root key file at ${keyFilePath} is not usable as a root key: it contains characters that are not hex digits (only 0-9 and a-f are allowed; a "0x" prefix, whitespace inside the value, or a base64 or PEM body all fail this). The keyring refuses to derive any key material from it rather than sealing under a shortened or empty key. ` +
                "IMPORTANT: anything sealed while this file was in place was sealed under key material derived from these same bytes, not from a real 32-byte key, so those stored credentials are not protected as intended — with empty or very short material the derived key is computable from published constants. " +
                "Replacing or regenerating the key will NOT restore them; it will make them unreadable. " +
                "Do not overwrite, delete or regenerate this key until you have decided what to do with the credentials already stored.",
        });
    });
});
test("a malformed env var that could never have sealed anything gets no already-sealed warning; a too-short one that could have, does", async () => {
    const envVarName = "PLATFORM_TEST_ENV_WARNING_SCOPE";
    try {
        process.env[envVarName] = "zz".repeat(32);
        const neverAccepted = new TestKeyring({ envVarName, allowFileFallback: false });
        const notHexError = await neverAccepted.derive({ workspaceId: "ws-1", purpose: "p", info: "i" }).then(() => undefined, (err: Error) => err);
        assert.ok(notHexError instanceof UnusableRootKeyError);
        assert.doesNotMatch(notHexError.message, /IMPORTANT/);
        process.env[envVarName] = "ab".repeat(16);
        const previouslyAccepted = new TestKeyring({ envVarName, allowFileFallback: false });
        const tooShortError = await previouslyAccepted.derive({ workspaceId: "ws-1", purpose: "p", info: "i" }).then(() => undefined, (err: Error) => err);
        assert.ok(tooShortError instanceof UnusableRootKeyError);
        assert.equal(tooShortError.reason, "too-short");
        assert.match(tooShortError.message, /^PLATFORM_TEST_ENV_WARNING_SCOPE is not usable as a root key: it is 16 bytes \(32 hex digits\); a root key must be at least 32 bytes \(64 hex digits\)/);
        assert.match(tooShortError.message, /anything sealed while this value was in place/);
    }
    finally {
        delete process.env[envVarName];
    }
});
test("inspectRootKeyMaterial reports the SAME rejection reason resolveRootKey throws with", async () => {
    await withTempDir(async (dir) => {
        const envVarName = "PLATFORM_TEST_UNSET_VAR_REASON_AGREEMENT";
        const keyFilePath = join(dir, "root-key.hex");
        writeFileSync(keyFilePath, "ab".repeat(8), { mode: 0o600 });
        assert.deepEqual(inspectRootKeyMaterial({ envVarName, keyFilePath }), {
            active: false,
            source: "file",
            invalid: true,
            reason: "too-short",
            keyFilePath,
        });
        const reveal = revealRootKeyMaterial({ envVarName, keyFilePath });
        assert.equal(reveal.hex, undefined, "reveal must not disclose rejected material either");
        assert.equal(reveal.reason, "too-short");
        const keyring = new TestKeyring({ envVarName, keyFilePath, allowFileFallback: true, allowFileAutoGenerate: false });
        await assert.rejects(() => keyring.derive({ workspaceId: "ws-1", purpose: "p", info: "i" }), { reason: "too-short" });
    });
});
test("a valid key file with a trailing newline is still usable — trimming whitespace around the value is not malformed", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "root-key.hex");
        writeFileSync(keyFilePath, `${"cd".repeat(32)}\n`, { mode: 0o600 });
        const status = inspectRootKeyMaterial({ envVarName: "PLATFORM_TEST_UNSET_VAR_TRAILING_NL", keyFilePath });
        assert.equal(status.active, true);
        const keyring = new TestKeyring({ envVarName: "PLATFORM_TEST_UNSET_VAR_TRAILING_NL", keyFilePath, allowFileFallback: true, allowFileAutoGenerate: false });
        const secret = await keyring.derive({ workspaceId: "ws-1", purpose: "p", info: "i" });
        assert.equal(secret.length, 32);
    });
});
test("a key longer than 32 bytes is still accepted — the floor is a minimum, not an exact length", async () => {
    const envVarName = "PLATFORM_TEST_LONG_ENV_KEY";
    process.env[envVarName] = "ef".repeat(64);
    try {
        assert.equal(inspectRootKeyMaterial({ envVarName, keyFilePath: "/should/never/be/touched" }).active, true);
        const keyring = new TestKeyring({ envVarName, allowFileFallback: false });
        const secret = await keyring.derive({ workspaceId: "ws-1", purpose: "p", info: "i" });
        assert.equal(secret.length, 32);
    }
    finally {
        delete process.env[envVarName];
    }
});
test.skipIf(process.platform === "win32")("generateFileRootKey creates a missing key directory at mode 0700", async () => {
    await withTempDir(async (dir) => {
        const keyFilePath = join(dir, "site-keys", "site-1.hex");
        generateFileRootKey({ keyFilePath });
        const { statSync } = await import("node:fs");
        assert.equal(statSync(join(dir, "site-keys")).mode & 0o777, 0o700);
        assert.equal(statSync(keyFilePath).mode & 0o777, 0o600);
    });
});
const hkdfSalt = Buffer.from("746f76752d696e746567726174696f6e732d726f6f742d6b65792d686b64662d7631", "hex");
// Only the test fixture supplies defaults. The public adapter requires all host options.
class TestKeyring extends EnvOrFileKeyring {
    constructor(options: Partial<import("../keyring.env.js").EnvOrFileKeyringRequired & import("../keyring.env.js").EnvOrFileKeyringOptions> = {}) {
        const { keyId, allowFileFallback, allowFileAutoGenerate, ...required } = options;
        super({ envVarName: "PLATFORM_TEST_MISSING", keyFilePath: "/should/never/be/touched", hkdfSalt, env: { read: ({ name }) => process.env[name] }, ...required, allowFileFallback: allowFileFallback ?? true, allowFileAutoGenerate: allowFileAutoGenerate ?? (allowFileFallback ?? true) }, { ...(keyId === undefined ? {} : { keyId }) });
    }
}
test("host configuration has no defaults in the public adapter", () => {
    for (const omitted of ["envVarName", "keyFilePath", "hkdfSalt"] as const) {
        const options = { envVarName: "PLATFORM_TEST_MISSING", keyFilePath: "/never", hkdfSalt, env: { read: () => undefined }, allowFileFallback: false, allowFileAutoGenerate: false };
        Reflect.deleteProperty(options, omitted);
        assert.throws(() => new EnvOrFileKeyring(options), new RegExp(`${omitted} is required`));
    }
});
test("a caller-chosen salt changes the derived secret with root key and labels held fixed", async () => {
    const input = { workspaceId: "ws-1", purpose: "secret-sealer", info: "v1" };
    const baseline = new FixedRootKeyKeyring({ hex: "aa".repeat(32), hkdfSalt }, {});
    const treatment = new FixedRootKeyKeyring({ hex: "aa".repeat(32), hkdfSalt: "another-host-salt" }, {});
    assert.notDeepEqual(await treatment.derive(input), await baseline.derive(input));
});

/** Characterization host injects its live environment instead of library ambient reads. */
const inspectionEnv = { read: ({ name }: { name: string }) => process.env[name] };
function inspectRootKeyMaterial(options: Omit<import("../keyring.env.js").InspectRootKeyMaterialOptions, "env">) { return inspectKeyMaterial({ ...options, env: inspectionEnv }); }
function revealRootKeyMaterial(options: Omit<import("../keyring.env.js").InspectRootKeyMaterialOptions, "env">) { return revealKeyMaterial({ ...options, env: inspectionEnv }); }
