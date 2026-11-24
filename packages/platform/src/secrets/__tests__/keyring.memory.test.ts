import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryKeyring } from "../keyring.memory.js";

// Moved with the host's in-memory keyring binding: the host now only injects its frozen salt.
const hkdfSalt = "fixture-salt";

test("InMemoryKeyring reports the default v1 key id and a caller-chosen key id, with or without the args object", async () => {
  assert.deepEqual(await new InMemoryKeyring({ hkdfSalt }).activeKey(), { keyId: "v1" });
  assert.deepEqual(await new InMemoryKeyring({ hkdfSalt }, { keyId: "v7" }).activeKey({}), { keyId: "v7" });
});

test("InMemoryKeyring derives deterministic 32-byte signing secrets that vary by subscription and version", async () => {
  const keyring = new InMemoryKeyring({ hkdfSalt });
  const input = { workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 };
  const first = await keyring.deriveSigningSecret(input);

  assert.equal(first.byteLength, 32);
  assert.deepEqual(await keyring.deriveSigningSecret(input), first);
  assert.notDeepEqual(await keyring.deriveSigningSecret({ ...input, version: 2 }), first);
  assert.notDeepEqual(await keyring.deriveSigningSecret({ ...input, subscriptionId: "sub-2" }), first);
});

test("InMemoryKeyring purpose derivation is stable per instance, separated by purpose/info, and isolated across instances", async () => {
  const keyring = new InMemoryKeyring({ hkdfSalt });
  const input = { workspaceId: "ws-1", purpose: "secrets-vault", info: "row-1" };
  const first = await keyring.derive(input);

  assert.ok(first.byteLength > 0);
  assert.deepEqual(await keyring.derive(input), first);
  assert.notDeepEqual(await keyring.derive({ ...input, purpose: "other" }), first);
  assert.notDeepEqual(await keyring.derive({ ...input, info: "row-2" }), first);
  assert.notDeepEqual(await new InMemoryKeyring({ hkdfSalt }).derive(input), first);
});
