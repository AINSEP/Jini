import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { onTestFinished, test, vi } from "vitest";

import { ScryptApiKeySecretHasher, createApiKeySecret, decoyKeyHash } from "../api-key-secret.js";

/**
 * @file Unit proof of the api-key secret lifecycle (SPEC-006 REQ-08 / INV-05) — the half of the
 * feature that has nothing to do with HTTP: what a minted key looks like, what an untrusted string
 * parses to, and what the stored digest does and does not reveal.
 *
 * The route-level counterpart is the host's api-key route tests.
 */

const { mintApiKey, parseApiKey } = createApiKeySecret({ prefix: "test_ak_" });

test("mintApiKey produces a prefixed key with a 256-bit secret, and never repeats", () => {
  const minted = Array.from({ length: 32 }, () => mintApiKey());

  for (const key of minted) {
    assert.match(key.rawKey, /^test_ak_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(key.rawKey, `${key.prefix}.${key.secret}`);
    // 43 base64url characters decode to exactly 32 bytes — the entropy the design rests on.
    assert.equal(Buffer.from(key.secret, "base64url").length, 32);
  }

  assert.equal(new Set(minted.map((key) => key.rawKey)).size, minted.length);
  assert.equal(new Set(minted.map((key) => key.prefix)).size, minted.length);
});

test("parseApiKey round-trips a minted key and rejects everything else", () => {
  const minted = mintApiKey();
  assert.deepEqual(parseApiKey({ rawKey: minted.rawKey }), { prefix: minted.prefix, secret: minted.secret });

  const rejected = [
    "",
    "garbage",
    minted.prefix, // prefix with no secret
    `${minted.prefix}.`, // empty secret
    `.${minted.secret}`, // empty prefix
    `test_ak_TOOSHORT.${minted.secret}`, // handle is not 12 hex chars
    `test_ak_${"0".repeat(13)}.${minted.secret}`, // handle is too long
    `test_sk_000000000000.${minted.secret}`, // wrong scheme marker
    `prefixtest_ak_000000000000.${minted.secret}`, // unanchored match attempt
  ];
  for (const candidate of rejected) {
    assert.equal(parseApiKey({ rawKey: candidate }), null, `rejected: ${JSON.stringify(candidate)}`);
  }
});

test("the stored digest verifies the right secret, rejects a wrong one, and leaks neither", async () => {
  const hasher = new ScryptApiKeySecretHasher();
  const minted = mintApiKey();
  const stored = await hasher.hash({ secret: minted.secret });

  assert.equal(await hasher.verify({ storedHash: stored, secret: minted.secret }), true);
  assert.equal(await hasher.verify({ storedHash: stored, secret: mintApiKey().secret }), false);
  assert.equal(await hasher.verify({ storedHash: stored, secret: "" }), false);
  assert.equal(await hasher.verify({ storedHash: stored, secret: `${minted.secret}x` }), false);

  // INV-05: the digest is not the secret, and does not contain it.
  assert.ok(!stored.includes(minted.secret));
  assert.match(stored, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
});

test("hashing the same secret twice produces different digests (per-key salt)", async () => {
  const hasher = new ScryptApiKeySecretHasher();
  const minted = mintApiKey();

  const [first, second] = await Promise.all([hasher.hash({ secret: minted.secret }), hasher.hash({ secret: minted.secret })]);
  assert.notEqual(first, second, "two hashes of one secret must not collide — no shared salt");
  assert.equal(await hasher.verify({ storedHash: first, secret: minted.secret }), true);
  assert.equal(await hasher.verify({ storedHash: second, secret: minted.secret }), true);
});

test("verify fails closed on a malformed, foreign, or hostile stored hash instead of throwing", async () => {
  const hasher = new ScryptApiKeySecretHasher();
  const secret = mintApiKey().secret;

  const malformed = [
    "",
    "not-a-hash",
    "scrypt$16384$8$1$onlyfourfields",
    "scrypt$16384$8$1$c2FsdA$", // empty digest
    "scrypt$16384$8$1$$ZGlnZXN0", // empty salt
    "argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0", // a password hash, not one of ours
    "scrypt$notanumber$8$1$c2FsdA$ZGlnZXN0",
    "scrypt$0$8$1$c2FsdA$ZGlnZXN0",
    // A parameter set large enough to be a memory-exhaustion lever if it were honored.
    "scrypt$1048576$8$1$c2FsdA$ZGlnZXN0",
  ];
  for (const stored of malformed) {
    assert.equal(await hasher.verify({ storedHash: stored, secret }), false, `rejected: ${JSON.stringify(stored)}`);
  }
});

test("decoyKeyHash hashes one verifiable decoy per hasher and rejects presented key secrets", async () => {
  const hasher = new ScryptApiKeySecretHasher();
  const hash = hasher.hash.bind(hasher);
  const inputs: string[] = [];
  vi.spyOn(hasher, "hash").mockImplementation(async ({ secret }: { secret: string }) => { inputs.push(secret); return hash({ secret }); });

  const first = await decoyKeyHash(hasher);
  const second = await decoyKeyHash(hasher);
  assert.equal(first, second, "memoized: one derivation per hasher per process");
  assert.match(first, /^scrypt\$/);
  assert.equal(inputs.length, 1, "memoization performs exactly one real hash");
  assert.equal(await hasher.verify({ storedHash: first, secret: inputs[0]! }), true, "the decoy digest must verify its captured input, so it cannot be a malformed prefix");
  // It must be well-formed enough that `verify` actually does the work — a digest that parsed to
  // null would return instantly and defeat the timing defence it exists to provide.
  assert.equal(await hasher.verify({ storedHash: first, secret: mintApiKey().secret }), false);

  const other = await decoyKeyHash(new ScryptApiKeySecretHasher());
  assert.notEqual(first, other, "not a shared constant across hashers");
});


for (const [label, n, r, p] of [
  ["fractional N", "2.5", "8", "1"],
  ["fractional r", "16384", "0.5", "1"],
  ["fractional p", "16384", "8", "0.5"],
  ["non-numeric r", "16384", "NaN", "1"],
  ["non-numeric p", "16384", "8", "NaN"],
  ["N of one", "1", "8", "1"],
  ["zero r", "16384", "0", "1"],
  ["negative r", "16384", "-1", "1"],
  ["zero p", "16384", "8", "0"],
  ["negative p", "16384", "8", "-1"],
  ["foreign scheme with six fields", "16384", "8", "1"],
] as const) {
  test(`verify rejects ${label}`, async () => {
    const scheme = label === "foreign scheme with six fields" ? "foreign" : "scrypt";
    const stored = `${scheme}$${n}$${r}$${p}$c2FsdA$ZGlnZXN0`;
    assert.equal(await new ScryptApiKeySecretHasher().verify({ storedHash: stored, secret: "presented-secret" }), false);
  });
}

test("verify rejects a nonempty digest of the wrong byte length", async () => {
  assert.equal(await new ScryptApiKeySecretHasher().verify({ storedHash: "scrypt$16384$8$1$c2FsdA$YQ", secret: "secret" }), false);
});

test("verify fails closed when scrypt rejects a non-power-of-two cost", async () => {
  assert.equal(await new ScryptApiKeySecretHasher().verify({ storedHash: "scrypt$3$8$1$c2FsdA$ZGlnZXN0", secret: "secret" }), false);
});

test("a crypto callback failure rejects hashing and fails verification closed", async () => {
  const failure = new Error("scrypt worker failed");
  // node:crypto is the true external boundary; parsing and fail-closed policy stay real.
  vi.spyOn(crypto, "scrypt").mockImplementation(((_secret: unknown, _salt: unknown, _length: number, _options: unknown, callback: (error: Error, derived: Buffer) => void) => callback(failure, Buffer.alloc(0))) as unknown as typeof crypto.scrypt);
  syncBuiltinESMExports();
  onTestFinished(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });
  const hasher = new ScryptApiKeySecretHasher();
  await assert.rejects(hasher.hash({ secret: "secret" }), { message: "scrypt worker failed" });
  assert.equal(await hasher.verify({ storedHash: "scrypt$16384$8$1$c2FsdA$ZGlnZXN0", secret: "secret" }), false);
});

test("createApiKeySecret binds one host prefix: its keys parse only under that prefix", () => {
  const other = createApiKeySecret({ prefix: "other_ak_" });
  const minted = other.mintApiKey();
  assert.match(minted.rawKey, /^other_ak_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(other.parseApiKey({ rawKey: minted.rawKey }), { prefix: minted.prefix, secret: minted.secret });
  assert.equal(parseApiKey({ rawKey: minted.rawKey }), null, "a key under another host prefix is not this host's credential");
  assert.equal(other.parseApiKey({ rawKey: mintApiKey().rawKey }), null);
});

test("createApiKeySecret refuses a prefix that could not round-trip through the anchored pattern", () => {
  for (const prefix of ["", "Upper_", "9ak_", "a.k_", "a$k_", "a+_", "a k_", "a|b"]) {
    assert.throws(() => createApiKeySecret({ prefix }), TypeError, JSON.stringify(prefix));
  }
});
