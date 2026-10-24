import assert from "node:assert/strict";
import { test } from "vitest";
import type { PasswordHasherPort } from "../../core/ports.js";
import type { SessionTokenPort } from "../../core/runtime-ports.js";
import {
  decideChallenge,
  hashChallengeCode,
  newChallengeSecrets,
  verifyChallengeCode,
  type AuthChallengeRecord,
} from "../auth-challenge.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import { NodeSessionTokens } from "../session-tokens.js";

const SCOPE = { workspaceId: "workspace-1", realm: "member", purpose: "signin" };
const NOW = "2026-10-24T12:00:00.000Z";
const TOKEN = "ab".repeat(32);
const HASHER = new Argon2PasswordHasher(
  { loadBinding: loadArgon2Binding },
  { memoryCost: 8, timeCost: 1, parallelism: 1 },
);

function challenge(overrides: Partial<AuthChallengeRecord> = {}): AuthChallengeRecord {
  return {
    ...SCOPE,
    id: "challenge-1",
    tokenHash: "stored-token-digest",
    codeHash: "stored-code-hash",
    expiresAt: "2026-10-24T12:15:00.000Z",
    consumedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

test.each([
  [0, "000000"],
  [7, "000007"],
  [12345, "012345"],
  [999999, "999999"],
] as const)("entropy value %i produces six-digit code %s without biasing the supplied draw", (value, expectedCode) => {
  const calls: unknown[] = [];
  const tokens: SessionTokenPort = {
    newToken: (input) => { calls.push(["newToken", input]); return TOKEN; },
    hashToken: (input) => { calls.push(["hashToken", input]); return "digest"; },
  };
  const secrets = newChallengeSecrets({
    tokens,
    randomInt: (input) => { calls.push(["randomInt", input]); return value; },
  });
  assert.deepEqual(secrets, { token: TOKEN, tokenHash: "digest", code: expectedCode });
  // The exclusive bound delegates uniform sampling to crypto.randomInt; no modulo reduction.
  assert.deepEqual(calls, [
    ["randomInt", { min: 0, max: 1_000_000 }],
    ["newToken", {}],
    ["hashToken", { rawToken: TOKEN }],
  ]);
});

test.each([-1, 1_000_000, 0.5, NaN, Infinity])("invalid entropy %s fails before creating a bearer", (value) => {
  const tokens: SessionTokenPort = {
    newToken: () => { throw new Error("must not mint a token"); },
    hashToken: () => { throw new Error("must not hash a token"); },
  };
  assert.throws(() => newChallengeSecrets({ tokens, randomInt: () => value }), RangeError);
});

test("the existing Node adapter provides a 256-bit link bearer and its storage digest", () => {
  const tokens = new NodeSessionTokens({});
  const { token, tokenHash, code } = newChallengeSecrets({ tokens, randomInt: () => 42 });
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash, token);
  assert.equal(tokenHash, tokens.hashToken({ rawToken: token }));
  assert.equal(code, "000042");
});

test("code hashing preserves leading zeros and verifies through the existing Argon2 adapter", async () => {
  const code = "000007";
  const hash = await hashChallengeCode({ code, hasher: HASHER });
  assert.notEqual(hash, code);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyChallengeCode({ code, hash, hasher: HASHER }), true);
  assert.equal(await verifyChallengeCode({ code: "000008", hash, hasher: HASHER }), false);
  assert.equal(await verifyChallengeCode({ code, hash: code, hasher: HASHER }), false);
  assert.equal(await verifyChallengeCode({ code, hash: "corrupt-hash", hasher: HASHER }), false);
});

test("hash and verify call the password-hasher owner with the original code", async () => {
  const calls: unknown[] = [];
  const hasher: PasswordHasherPort = {
    hash: async (input) => { calls.push(["hash", input]); return "salted-code-hash"; },
    verify: async (input) => { calls.push(["verify", input]); return false; },
  };
  assert.equal(await hashChallengeCode({ code: "000042", hasher }), "salted-code-hash");
  assert.equal(await verifyChallengeCode({ code: "000042", hash: "salted-code-hash", hasher }), false);
  assert.deepEqual(calls, [
    ["hash", { password: "000042" }],
    ["verify", { password: "000042", hash: "salted-code-hash" }],
  ]);
});

test.each(["", "12345", "1234567", "123456\n", "123456\r", " 12345", "12345 ", "１２３４５６", "١٢٣٤٥٦", "12a456"])(
  "malformed code %j is refused without invoking the hasher", async (code) => {
    const hasher: PasswordHasherPort = {
      hash: async () => { throw new Error("must not hash malformed code"); },
      verify: async () => { throw new Error("must not verify malformed code"); },
    };
    assert.throws(() => hashChallengeCode({ code, hasher }), RangeError);
    assert.equal(await verifyChallengeCode({ code, hash: "stored-hash", hasher }), false);
  },
);

test.each([null, ""])("a link-only or missing code hash %s cannot authenticate a code", async (hash) => {
  const hasher: PasswordHasherPort = {
    hash: async () => { throw new Error("must not hash"); },
    verify: async () => { throw new Error("must not verify absent hash"); },
  };
  assert.equal(await verifyChallengeCode({ code: "000007", hash, hasher }), false);
});

test("hasher failures propagate without returning successful proof", async () => {
  const failure = new Error("hasher unavailable");
  const hasher: PasswordHasherPort = {
    hash: async () => { throw failure; },
    verify: async () => { throw failure; },
  };
  await assert.rejects(hashChallengeCode({ code: "123456", hasher }), failure);
  await assert.rejects(verifyChallengeCode({ code: "123456", hash: "stored-hash", hasher }), failure);
});

test("a live matching challenge is eligible without consuming or mutating it", () => {
  const record = Object.freeze(challenge());
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "ok");
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "ok");
  assert.equal(record.consumedAt, null);
  assert.equal(record.failedAttempts, 0);
});

test("legacy link-only metadata stays eligible; code verification remains unavailable", () => {
  const { consumedAt: _consumedAt, ...record } = challenge({ codeHash: null });
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "ok");
});

test.each([
  ["expired", { expiresAt: "2026-10-24T11:59:59.999Z" }],
  ["at expiry", { expiresAt: NOW }],
  ["consumed", { consumedAt: "2026-10-24T11:59:00.000Z" }],
  ["empty consumption stamp", { consumedAt: "" }],
  ["wrong workspace", { workspaceId: "workspace-2" }],
  ["wrong realm", { realm: "staff" }],
  ["wrong purpose", { purpose: "password_reset" }],
  ["exhausted", { failedAttempts: 5 }],
  ["over limit", { failedAttempts: 6 }],
  ["negative attempts", { failedAttempts: -1 }],
  ["fractional attempts", { failedAttempts: 0.5 }],
  ["NaN attempts", { failedAttempts: NaN }],
  ["infinite attempts", { failedAttempts: Infinity }],
  ["unsafe counter", { failedAttempts: Number.MAX_SAFE_INTEGER + 1 }],
  ["invalid expiry", { expiresAt: "not-a-date" }],
] satisfies [string, Partial<AuthChallengeRecord>][])("%s returns the same invalid decision", (_name, patch) => {
  assert.equal(decideChallenge({ ...SCOPE, record: challenge(patch), nowIso: NOW }), "invalid");
});

test("missing challenges and invalid clock values fail closed", () => {
  assert.equal(decideChallenge({ ...SCOPE, record: null, nowIso: NOW }), "invalid");
  assert.equal(decideChallenge({ ...SCOPE, record: challenge(), nowIso: "bad-clock" }), "invalid");
});

test("expiry compares instants rather than lexical timestamp order", () => {
  const record = challenge({ expiresAt: "2026-10-24T13:00:00.000+01:00" });
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "invalid");
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: "2026-10-24T11:59:59.999Z" }), "ok");
});

test("the fifth failed attempt disables the same challenge for code and link completion", () => {
  const record = challenge({ failedAttempts: 4 });
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "ok");
  const exhausted = { ...record, failedAttempts: 5 };
  assert.equal(decideChallenge({ ...SCOPE, record: exhausted, nowIso: NOW }), "invalid");
  const consumed = { ...record, consumedAt: NOW };
  assert.equal(decideChallenge({ ...SCOPE, record: consumed, nowIso: NOW }), "invalid");
});

test("sign-in and reset challenges cannot substitute for one another", () => {
  const record = challenge({ purpose: "password_reset" });
  assert.equal(decideChallenge({ ...SCOPE, record, nowIso: NOW }), "invalid");
  assert.equal(decideChallenge({ ...SCOPE, purpose: "password_reset", record, nowIso: NOW }), "ok");
  assert.equal(decideChallenge({ ...SCOPE, purpose: "password_reset", record: challenge(), nowIso: NOW }), "invalid");
});

test("a custom attempt limit is enforced at its boundary", () => {
  assert.equal(decideChallenge({ ...SCOPE, record: challenge({ failedAttempts: 1 }), nowIso: NOW, maxAttempts: 2 }), "ok");
  assert.equal(decideChallenge({ ...SCOPE, record: challenge({ failedAttempts: 2 }), nowIso: NOW, maxAttempts: 2 }), "invalid");
});

test.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("invalid attempt limit %s fails closed", (maxAttempts) => {
  assert.equal(decideChallenge({ ...SCOPE, record: challenge(), nowIso: NOW, maxAttempts }), "invalid");
});
