import assert from "node:assert/strict";
import { test } from "vitest";

import { COMMENTS_IP_SALT_PURPOSE, DEV_COMMENTS_IP_SALT, resolveCommentsIpHashSalt, type CommentsIpSaltKeyring } from "../ip-hash-salt.js";

/**
 * @file `resolveCommentsIpHashSalt` (2026-10-08 hardwiring audit #4): the comments IP-hash salt is
 * an explicit env value, else a site-key derivation, and never the public dev constant in
 * production. DI fakes only — the keyring, entropy and warning sink are all injected ports.
 */

const WORKSPACE = "workspace-1";

/** Records every derive call and returns fixed bytes, like a resolved site key would. */
function recordingKeyring(bytes: Uint8Array): CommentsIpSaltKeyring & { calls: { workspaceId: string; purpose: string; info: string }[] } {
  const calls: { workspaceId: string; purpose: string; info: string }[] = [];
  return { calls, derive: async (input) => { calls.push(input); return bytes; } };
}

/** A keyring with no usable site key: `EnvOrFileKeyring.derive` rejects exactly like this. */
const missingKeyring: CommentsIpSaltKeyring = { derive: async () => { throw new Error("no site key: none of the configured sources resolved"); } };

test("an explicit COMMENTS_IP_SALT wins and the keyring is never consulted", async () => {
  const keyring = recordingKeyring(new Uint8Array([1, 2, 3]));
  const resolved = await resolveCommentsIpHashSalt({ env: { COMMENTS_IP_SALT: "operator-salt-fixture" }, mode: "production", workspaceId: WORKSPACE, keyring });
  assert.deepEqual(resolved, { salt: "operator-salt-fixture", source: "env" });
  assert.deepEqual(keyring.calls, []);
});

test("unset or blank COMMENTS_IP_SALT derives the salt from the site key under its own purpose", async () => {
  for (const env of [{}, { COMMENTS_IP_SALT: "" }, { COMMENTS_IP_SALT: "   " }]) {
    const keyring = recordingKeyring(new Uint8Array([0xab, 0xcd, 0x01]));
    const resolved = await resolveCommentsIpHashSalt({ env, mode: "production", workspaceId: WORKSPACE, keyring });
    assert.deepEqual(resolved, { salt: "abcd01", source: "site-key" });
    assert.deepEqual(keyring.calls, [{ workspaceId: WORKSPACE, purpose: COMMENTS_IP_SALT_PURPOSE, info: "v1" }]);
  }
  assert.equal(COMMENTS_IP_SALT_PURPOSE, "comments-ip-hash-salt");
});

test("local mode with no usable site key keeps the dev constant and says nothing", async () => {
  const warnings: string[] = [];
  const resolved = await resolveCommentsIpHashSalt({ env: {}, mode: "local", workspaceId: WORKSPACE, keyring: missingKeyring }, { warn: (line) => warnings.push(line), randomHex: () => "unused" });
  assert.deepEqual(resolved, { salt: "dev-only-insecure-salt", source: "dev-default" });
  assert.equal(DEV_COMMENTS_IP_SALT, "dev-only-insecure-salt");
  assert.deepEqual(warnings, []);
});

test("production with no usable site key never falls back to the public constant: random salt plus one warning", async () => {
  const warnings: string[] = [];
  const resolved = await resolveCommentsIpHashSalt(
    { env: {}, mode: "production", workspaceId: WORKSPACE, keyring: missingKeyring },
    { warn: (line) => warnings.push(line), randomHex: () => "f00d".repeat(16) }
  );
  assert.deepEqual(resolved, { salt: "f00d".repeat(16), source: "ephemeral" });
  assert.notEqual(resolved.salt, DEV_COMMENTS_IP_SALT);
  assert.deepEqual(warnings, [
    "[comments] COMMENTS_IP_SALT is unset and no site key resolved: using a random per-process salt, so comment IP hashes will not match across restarts. Set COMMENTS_IP_SALT.",
  ]);
});

test("the default production entropy is 32 random bytes, different per call", async () => {
  const quiet = { warn: () => undefined };
  const first = await resolveCommentsIpHashSalt({ env: {}, mode: "production", workspaceId: WORKSPACE, keyring: missingKeyring }, quiet);
  const second = await resolveCommentsIpHashSalt({ env: {}, mode: "production", workspaceId: WORKSPACE, keyring: missingKeyring }, quiet);
  assert.match(first.salt, /^[0-9a-f]{64}$/);
  assert.notEqual(first.salt, second.salt);
});

test("the default production warning explains the ephemeral salt without disclosing it", async t => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (line: string) => { warnings.push(line); });
  const result = await resolveCommentsIpHashSalt(
    { env: {}, mode: "production", workspaceId: WORKSPACE, keyring: missingKeyring },
    { randomHex: () => "private-ephemeral-salt" },
  );
  assert.deepEqual(result, { salt: "private-ephemeral-salt", source: "ephemeral" });
  assert.deepEqual(warnings, ["[comments] COMMENTS_IP_SALT is unset and no site key resolved: using a random per-process salt, so comment IP hashes will not match across restarts. Set COMMENTS_IP_SALT."]);
});
