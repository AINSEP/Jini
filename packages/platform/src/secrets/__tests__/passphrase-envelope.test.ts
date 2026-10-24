import assert from "node:assert/strict";
import { hkdfSync, scryptSync } from "node:crypto";
import { test } from "vitest";

// Import the public barrel so the release test also checks the promised export.
import { openWithPassphrase, sealWithPassphrase } from "../index.js";
import { FixedRootKeyKeyring } from "../keyring.env.js";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";

const passphrase = "portable recovery phrase — fixture only";
const payload = JSON.stringify({ entries: [{ id: "entry-1", value: "fixture-secret-value" }] });
const deterministicRandom = ({ byteLength }: { byteLength: number }) => Buffer.alloc(byteLength, 0xab);

test("portable JSON round-trips UTF-8 payload without a host key or filesystem", async () => {
  const envelope = await sealWithPassphrase({ payload, passphrase });
  assert.equal(await openWithPassphrase({ envelope, passphrase }), payload);
  assert.doesNotMatch(envelope, /fixture-secret-value|portable recovery phrase/);
});

test("empty payload round-trips; an empty passphrase is refused before any KDF work", async () => {
  const envelope = await sealWithPassphrase({ payload: "", passphrase: "x" });
  assert.equal(await openWithPassphrase({ envelope, passphrase: "x" }), "");
  await assert.rejects(() => sealWithPassphrase({ payload, passphrase: "" }), {
    name: "TypeError", message: "Passphrase envelope: passphrase must not be empty",
  });
});

test("each export gets a fresh salt and nonce", async () => {
  const first = JSON.parse(await sealWithPassphrase({ payload, passphrase }));
  const second = JSON.parse(await sealWithPassphrase({ payload, passphrase }));
  assert.notEqual(first.header.kdf.salt, second.header.kdf.salt);
  assert.notEqual(first.sealed.nonce, second.sealed.nonce);
  assert.notEqual(first.sealed.ciphertext, second.sealed.ciphertext);
});

test("wrong passphrase fails without disclosing input values", async () => {
  const envelope = await sealWithPassphrase({ payload, passphrase });
  await assert.rejects(() => openWithPassphrase({ envelope, passphrase: "wrong phrase" }), {
    name: "Error", message: "Passphrase envelope: authentication failed",
  });
});

test("passphrases are not trimmed or normalized", async () => {
  const envelope = await sealWithPassphrase({ payload, passphrase: " spaced " });
  await assert.rejects(() => openWithPassphrase({ envelope, passphrase: "spaced" }), /authentication failed/);
  assert.equal(await openWithPassphrase({ envelope, passphrase: " spaced " }), payload);
});

test("the complete header is AAD even when a salt spelling derives the same key", async () => {
  const parsed = JSON.parse(await sealWithPassphrase({ payload, passphrase }, { randomBytesFn: deterministicRandom }));
  // Hex case changes no derived bytes. Failure therefore proves header authentication,
  // rather than merely demonstrating that a different salt derives a different key.
  parsed.header.kdf.salt = parsed.header.kdf.salt.toUpperCase();
  await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(parsed), passphrase }), /authentication failed/);
});

test("additional header metadata cannot be added without invalidating authentication", async () => {
  const parsed = JSON.parse(await sealWithPassphrase({ payload, passphrase }));
  parsed.header.description = "modified metadata";
  await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(parsed), passphrase }), /authentication failed/);
});

for (const field of ["ciphertext", "nonce"] as const) {
  test(`modified ${field} never returns partial plaintext`, async () => {
    const parsed = JSON.parse(await sealWithPassphrase({ payload, passphrase }));
    const bytes = Buffer.from(parsed.sealed[field], "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    parsed.sealed[field] = bytes.toString("base64");
    await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(parsed), passphrase }), /authentication failed/);
  });
}

test("exports contain only the public header and sealed data, never derived or wrapped keys", async () => {
  const envelope = await sealWithPassphrase({ payload, passphrase }, { randomBytesFn: deterministicRandom });
  const parsed = JSON.parse(envelope);
  assert.deepEqual(Object.keys(parsed).sort(), ["header", "sealed"]);
  assert.deepEqual(Object.keys(parsed.header).sort(), ["format", "kdf", "version"]);
  assert.deepEqual(Object.keys(parsed.header.kdf).sort(), ["N", "name", "p", "r", "salt"]);
  assert.deepEqual(Object.keys(parsed.sealed).sort(), ["alg", "ciphertext", "keyId", "nonce"]);
  const root = scryptSync(passphrase, Buffer.from(parsed.header.kdf.salt, "hex"), 32,
    { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const aesKey = Buffer.from(hkdfSync("sha256", root, "jini-passphrase-envelope-v1", "secret-sealer.v1:secret-sealer:v1", 32));
  for (const key of [root, aesKey]) {
    assert.equal(envelope.includes(key.toString("hex")), false);
    assert.equal(envelope.includes(key.toString("base64")), false);
  }
  assert.equal(await openWithPassphrase({ envelope, passphrase }), payload);
});

test("opens a portable fixture made with the existing keyring and sealer at the supported lower cost", async () => {
  const header = {
    format: "jini-passphrase-envelope", version: 1,
    kdf: { name: "scrypt", salt: "ab".repeat(16), N: 16384, r: 8, p: 1 },
  };
  const root = scryptSync(passphrase, Buffer.from(header.kdf.salt, "hex"), 32);
  const keyring = new FixedRootKeyKeyring({ hex: root.toString("hex"), hkdfSalt: "jini-passphrase-envelope-v1" });
  const sealed = await new AesGcmSecretSealer({ keyring }).seal({
    plaintext: payload, key: await keyring.activeKey({}), aad: JSON.stringify(header),
  });
  assert.equal(await openWithPassphrase({ envelope: JSON.stringify({ header, sealed }), passphrase }), payload);
});

// No expensive derivation is needed to reject these untrusted KDF requests.
for (const [field, value] of [
  ["N", 0], ["N", 2], ["N", 32769], ["N", 131072], ["N", 2 ** 40], ["N", "32768"],
  ["r", 0], ["r", 9], ["r", 2 ** 30], ["p", 0], ["p", 2], ["p", 2 ** 30],
  ["salt", "ab"], ["salt", "zz".repeat(16)], ["name", "unknown"],
] as const) {
  test(`rejects unsupported KDF ${field}=${value} before derivation`, async () => {
    const envelope = invalidFixture();
    envelope.header.kdf = { ...envelope.header.kdf, [field]: value };
    await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(envelope), passphrase }), /invalid or unsupported envelope/);
  });
}

for (const envelope of ["{", "null", "[]", "{}", '{"header":null}', '{"header":[]}']) {
  test(`rejects malformed envelope ${envelope}`, async () => {
    await assert.rejects(() => openWithPassphrase({ envelope, passphrase }), /Passphrase envelope:/);
  });
}

for (const patch of [{ format: "other" }, { version: 2 }, { kdf: null }]) {
  test(`rejects unsupported header ${JSON.stringify(patch)}`, async () => {
    const envelope = invalidFixture();
    Object.assign(envelope.header, patch);
    await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(envelope), passphrase }), /invalid or unsupported envelope/);
  });
}

for (const patch of [
  { alg: "other" }, { keyId: "v2" }, { nonce: "AA==" }, { nonce: "!".repeat(16) },
  { ciphertext: "AA==" }, { ciphertext: "!".repeat(24) }, { ciphertext: 123 },
]) {
  test(`rejects malformed sealed data ${JSON.stringify(patch)}`, async () => {
    const envelope = invalidFixture();
    Object.assign(envelope.sealed, patch);
    await assert.rejects(() => openWithPassphrase({ envelope: JSON.stringify(envelope), passphrase }), /invalid or unsupported envelope/);
  });
}

test("bounds UTF-8 payload and serialized input sizes before crypto work", async () => {
  await assert.rejects(() => sealWithPassphrase({ payload: "é".repeat(8 * 1024 * 1024 + 1), passphrase }), /size limit exceeded/);
  await assert.rejects(() => openWithPassphrase({ envelope: " ".repeat(24 * 1024 * 1024 + 1), passphrase }), /size limit exceeded/);
});

test("rejects invalid randomness for both salt and nonce", async () => {
  await assert.rejects(() => sealWithPassphrase({ payload, passphrase }, {
    randomBytesFn: () => Buffer.alloc(15),
  }), /salt must contain exactly 16 bytes/);
  await assert.rejects(() => sealWithPassphrase({ payload, passphrase }, {
    randomBytesFn: ({ byteLength }) => Buffer.alloc(byteLength === 16 ? 16 : 11),
  }), /IV must contain exactly 12 bytes/);
});

function invalidFixture() {
  return {
    header: {
      format: "jini-passphrase-envelope", version: 1,
      kdf: { name: "scrypt", salt: "ab".repeat(16), N: 32768, r: 8, p: 1 } as Record<string, unknown>,
    },
    sealed: { alg: "aes-256-gcm", keyId: "v1", nonce: Buffer.alloc(12).toString("base64"), ciphertext: Buffer.alloc(16).toString("base64") },
  };
}
