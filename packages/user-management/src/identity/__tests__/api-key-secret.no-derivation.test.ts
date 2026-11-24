import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { onTestFinished, test } from "vitest";

import { ScryptApiKeySecretHasher } from "../api-key-secret.js";

/**
 * @file F6 fix wave (Stryker: ~30 survivors in api-key-secret.ts's stored-hash parser were "equivalent
 * by output", because scrypt itself also rejects bad parameters and `verify` fails closed). What the
 * parser actually guarantees is that a malformed or hostile `key_hash` never reaches scrypt at all,
 * so a hand-edited row cannot become a CPU/memory lever. That is pinned here by counting real scrypt
 * calls through the builtin's live ESM binding.
 */

function countScrypt(): { calls: () => number } {
  const original = crypto.scrypt;
  let calls = 0;
  crypto.scrypt = ((...args: Parameters<typeof crypto.scrypt>) => { calls++; return (original as (...a: unknown[]) => void)(...args); }) as typeof crypto.scrypt;
  syncBuiltinESMExports();
  onTestFinished(() => { crypto.scrypt = original; syncBuiltinESMExports(); });
  return { calls: () => calls };
}

const SALT = "c2FsdA", DIGEST = "ZGlnZXN0";

for (const [label, stored] of [
  ["N of one", `scrypt$1$8$1$${SALT}$${DIGEST}`], ["zero N", `scrypt$0$8$1$${SALT}$${DIGEST}`],
  ["zero r", `scrypt$16384$0$1$${SALT}$${DIGEST}`], ["zero p", `scrypt$16384$8$0$${SALT}$${DIGEST}`],
  ["fractional N", `scrypt$2.5$8$1$${SALT}$${DIGEST}`], ["fractional r", `scrypt$16384$0.5$1$${SALT}$${DIGEST}`], ["fractional p", `scrypt$16384$8$0.5$${SALT}$${DIGEST}`],
  ["a memory lever (128*N*r over 64 MiB)", `scrypt$65536$9$1$${SALT}$${DIGEST}`], ["a huge p", `scrypt$16384$8$99999999999999999999$${SALT}$${DIGEST}`],
  // SOURCE BUG found by this file (F6): scrypt's CPU work is linear in p (~41 ms per unit at N=16384, r=8,
  // measured), and p was unbounded — p=100000 would hold a libuv threadpool thread for over an hour.
  ["a CPU lever (p=1000)", `scrypt$16384$8$1000$${SALT}$${DIGEST}`], ["p=5 at the default N and r", `scrypt$16384$8$5$${SALT}$${DIGEST}`],
  ["an empty salt", `scrypt$16384$8$1$$${DIGEST}`], ["an empty digest", `scrypt$16384$8$1$${SALT}$`],
  ["a missing field", `scrypt$16384$8$1$${SALT}`], ["an extra field", `scrypt$16384$8$1$${SALT}$${DIGEST}$x`], ["another scheme", `argon2$16384$8$1$${SALT}$${DIGEST}`],
] as const) {
  test(`verify refuses ${label} WITHOUT running scrypt`, async () => {
    const scrypt = countScrypt();
    assert.equal(await new ScryptApiKeySecretHasher().verify({ storedHash: stored, secret: "presented-secret" }), false);
    assert.equal(scrypt.calls(), 0);
  });
}

test("the largest admitted work (128*N*r*p exactly 64 MiB), the minimum (N=2, r=1, p=1) and this file's own parameters reach scrypt", async () => {
  const scrypt = countScrypt();
  for (const stored of [`scrypt$65536$8$1$${SALT}$${DIGEST}`, `scrypt$16384$8$4$${SALT}$${DIGEST}`, `scrypt$2$1$1$${SALT}$${DIGEST}`, `scrypt$16384$8$1$${SALT}$${DIGEST}`]) {
    assert.equal(await new ScryptApiKeySecretHasher().verify({ storedHash: stored, secret: "presented-secret" }), false);
  }
  assert.equal(scrypt.calls(), 4);
});

test("a digest this file writes still verifies after the work bound (no legitimate row is refused)", async () => {
  const hasher = new ScryptApiKeySecretHasher();
  const stored = await hasher.hash({ secret: "the-secret" });
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await hasher.verify({ storedHash: stored, secret: "the-secret" }), true);
});
