import assert from "node:assert/strict";
import { test } from "vitest";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import { createStoreKeyring, protectStorage, type StorageFailureSource } from "../credential-sets/store-vault-guards.js";

/** Typed fake keyring: records each call and answers with fixed bytes / key handle. */
function recordingKeyring(): { keyring: KeyringPort; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { calls, keyring: {
    derive: async input => { calls.push(["derive", input]); return new Uint8Array([1]); },
    deriveSigningSecret: async input => { calls.push(["deriveSigningSecret", input]); return new Uint8Array([2]); },
    activeKey: async input => { calls.push(["activeKey", input]); return { keyId: "active" }; },
  } };
}

/** Storage-error translator that numbers each error and records what it was given. */
function countingSource(keyring?: KeyringPort): StorageFailureSource & { seen: unknown[][] } {
  const seen: unknown[][] = [];
  return { ...(keyring === undefined ? {} : { keyring }), seen, storageError: (_required, options) => { seen.push(options ? [options.error] : []); return new Error(`storage failure ${seen.length}`); } };
}

const deriveInput = { workspaceId: "ws", purpose: "webhook", info: "v1" };
const signingInput = { workspaceId: "ws", subscriptionId: "sub", version: 2 };

test("derive delegates its input to the injected keyring", async () => {
  const { keyring, calls } = recordingKeyring();
  assert.deepEqual(await createStoreKeyring({ source: countingSource(keyring) }).derive(deriveInput), new Uint8Array([1]));
  assert.deepEqual(calls, [["derive", deriveInput]]);
  assert.equal(calls[0]?.[1], deriveInput, "the same request object is forwarded");
});
test("deriveSigningSecret delegates its input to the injected keyring", async () => {
  const { keyring, calls } = recordingKeyring();
  assert.deepEqual(await createStoreKeyring({ source: countingSource(keyring) }).deriveSigningSecret(signingInput), new Uint8Array([2]));
  assert.deepEqual(calls, [["deriveSigningSecret", signingInput]]);
});
test("activeKey asks the injected keyring with an empty request", async () => {
  const { keyring, calls } = recordingKeyring();
  assert.deepEqual(await createStoreKeyring({ source: countingSource(keyring) }, {}).activeKey({}), { keyId: "active" });
  assert.deepEqual(calls, [["activeKey", {}]]);
});
for (const method of ["derive", "deriveSigningSecret", "activeKey"] as const) {
  test(`${method} without a keyring rejects with the storage error translated a second time`, async () => {
    const source = countingSource();
    const keyring = createStoreKeyring({ source });
    const call = method === "derive" ? keyring.derive(deriveInput) : method === "deriveSigningSecret" ? keyring.deriveSigningSecret(signingInput) : keyring.activeKey({});
    await assert.rejects(call, { message: "storage failure 2" });
    assert.deepEqual(source.seen[0], []);
    const inner = source.seen[1]?.[0];
    assert.ok(inner instanceof Error);
    assert.equal(inner.message, "storage failure 1");
  });
}
test("a keyring failure reaches the storage error translator as its argument", async () => {
  const failure = new Error("private key detail");
  const { keyring } = recordingKeyring();
  const source = countingSource({ ...keyring, derive: async () => { throw failure; } });
  await assert.rejects(createStoreKeyring({ source }).derive(deriveInput), { message: "storage failure 1" });
  assert.deepEqual(source.seen, [[failure]]);
});
test("the keyring is read when called, not when the guard is created", async () => {
  const source = countingSource();
  const guarded = createStoreKeyring({ source });
  const { keyring, calls } = recordingKeyring();
  source.keyring = keyring;
  assert.deepEqual(await guarded.activeKey({}), { keyId: "active" });
  assert.equal(calls.length, 1);
});
test("protectStorage returns the operation's result untouched", async () => {
  const result = { value: 1 };
  assert.equal(await protectStorage({ operation: async () => result, source: countingSource() }, {}), result);
});
test("protectStorage translates a synchronous throw from the operation", async () => {
  const failure = new Error("sync crypto failure");
  const source = countingSource();
  await assert.rejects(protectStorage({ operation: () => { throw failure; }, source }), { message: "storage failure 1" });
  assert.deepEqual(source.seen, [[failure]]);
});
