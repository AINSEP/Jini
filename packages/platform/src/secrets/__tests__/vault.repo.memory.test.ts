import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryVaultRepo, type VaultRecord } from "../credential-sets/index.js";

function row(id: string, patch: Partial<VaultRecord> = {}): VaultRecord {
  return { workspaceId: "ws", id, kind: "vendor", ownerKey: "deploy", principalId: null, binding: null,
    provider: "host", label: id, isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: { accountLabel: null }, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch };
}
const query = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, provider: "host" };

test("delimiter-containing row identities cannot alias another workspace", async () => {
  const repo = new InMemoryVaultRepo({});
  await repo.put({ record: row("b::c", { workspaceId: "a" }), expectedRevision: null });
  await repo.put({ record: row("c", { workspaceId: "a::b" }), expectedRevision: null });
  assert.equal((await repo.find({ workspaceId: "a", id: "b::c" }))?.workspaceId, "a");
  assert.equal((await repo.find({ workspaceId: "a::b", id: "c" }))?.workspaceId, "a::b");
  assert.equal(await repo.find({ workspaceId: "a", id: "c" }), null);
});

test("delete promotes newest then greatest ID, updates its revision and never crosses a group", async () => {
  const repo = new InMemoryVaultRepo({});
  for (const record of [row("a"), row("b"), row("c"), row("z", { updatedAt: "2026-10-10T00:00:00Z" }), row("foreign", { provider: "other" })]) {
    await repo.put({ record, expectedRevision: null });
  }
  await assert.rejects(repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 0 }), { code: "conflict" });
  assert.equal(await repo.delete({ workspaceId: "other", id: "a", expectedRevision: 1 }), false);
  assert.equal(await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 }), true);
  assert.equal((await repo.find({ workspaceId: "ws", id: "c" }))?.isDefault, true);
  assert.equal((await repo.find({ workspaceId: "ws", id: "c" }))?.revision, 2);
  assert.equal((await repo.find({ workspaceId: "ws", id: "foreign" }))?.revision, 1);
  await repo.delete({ workspaceId: "ws", id: "b", expectedRevision: 1 });
  assert.equal((await repo.find({ workspaceId: "ws", id: "c" }))?.revision, 2);
  assert.equal(await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 }), false);
});

test("targeted metadata updates preserve sealed material and clones stop alias writes bypassing CAS", async () => {
  const repo = new InMemoryVaultRepo({});
  const input = row("a", { sealed: { keyId: "v1", nonce: "n", ciphertext: "c", alg: "aes-256-gcm" } });
  const saved = await repo.put({ record: input, expectedRevision: null });
  input.meta.accountLabel = "input alias";
  input.sealed!.ciphertext = "input alias";
  saved.meta.accountLabel = "output alias";
  const found = (await repo.find(input))!;
  found.meta.accountLabel = "find alias";
  const listed = (await repo.list(query))[0]!;
  listed.meta.accountLabel = "list alias";
  const before = (await repo.find(input))!;
  assert.equal(before.meta.accountLabel, null);
  assert.equal(before.sealed?.ciphertext, "c");
  const patch = { accountLabel: "verified" };
  const after = await repo.patchMeta({ ...input, expectedRevision: 1, patch, updatedAt: "later" });
  patch.accountLabel = "patch alias";
  assert.deepEqual(after.sealed, before.sealed);
  assert.equal(after.meta.accountLabel, "verified");
  assert.equal(after.revision, 2);
  assert.equal(after.isDefault, before.isDefault);
  assert.equal(after.updatedAt, "later");
  await assert.rejects(repo.patchMeta({ ...input, expectedRevision: 1, patch, updatedAt: "stale" }), { code: "conflict" });
});

test("converted custom null-provider group keeps independent labels/defaults and immutable subtype", async () => {
  const repo = new InMemoryVaultRepo({});
  const customMeta = { credentialType: "custom", worksFor: ["vercel"] };
  const vendor = await repo.put({ record: row("vendor", { label: "Production",
    meta: { credentialType: "vendor", worksFor: ["vercel"] } }), expectedRevision: null });
  const custom = await repo.put({ record: row("custom", { provider: null, label: "Production", meta: customMeta }), expectedRevision: null });
  await repo.put({ record: row("next", { provider: null, meta: customMeta }), expectedRevision: null });
  await assert.rejects(repo.put({ record: row("collision", { provider: null, label: "Production", meta: customMeta }), expectedRevision: null }), { code: "conflict" });
  await assert.rejects(repo.put({ record: { ...custom, revision: 2, meta: { credentialType: "vendor", worksFor: [] } }, expectedRevision: 1 }), { code: "context" });
  await repo.delete({ ...custom, expectedRevision: 1 });
  assert.equal((await repo.findDefault({ ...query, provider: null }))?.id, "next");
  assert.equal((await repo.findDefault(query))?.id, "vendor");
  assert.deepEqual(await repo.find(vendor), vendor);
});
