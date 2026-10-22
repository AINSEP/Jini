import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { InMemoryVaultRepo, type VaultRecord } from "../credential-sets/index.js";

function row(id: string, patch: Partial<VaultRecord> = {}): VaultRecord {
  return { workspaceId: "ws", id, kind: "vendor", ownerKey: "deploy", principalId: null, binding: null,
    provider: "host", label: id, isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: { accountLabel: null }, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch };
}
const query = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, provider: "host" };
const conflict = { code: "conflict", message: "Secrets vault: conflict", name: "VaultError" };
const invalidRecord = { code: "invalid-record", message: "Secrets vault: invalid-record", name: "VaultError" };
function pick(record: VaultRecord | null): { isDefault: boolean; revision: number } | null {
  return record && { isDefault: record.isDefault, revision: record.revision };
}

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

describe("InMemoryVaultRepo putRecord", () => {
  test("first row in a group becomes default even when submitted as non-default", async () => {
    const repo = new InMemoryVaultRepo({});
    assert.equal((await repo.put({ record: row("a"), expectedRevision: null })).isDefault, true);
  });

  test("later non-default rows join without taking the default", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    assert.equal((await repo.put({ record: row("b", { label: "other" }), expectedRevision: null })).isDefault, false);
    assert.equal((await repo.find({ workspaceId: "ws", id: "a" }))?.revision, 1);
  });

  test("an explicit default clears the previous default and bumps its revision", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { isDefault: true }), expectedRevision: null });
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "a" })), { isDefault: false, revision: 2 });
  });

  test("an explicit default leaves other groups' defaults alone", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { provider: "other" }), expectedRevision: null });
    await repo.put({ record: row("b", { isDefault: true }), expectedRevision: null });
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "a" })), { isDefault: true, revision: 1 });
  });

  test("re-saving the current default does not clear itself", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    assert.deepEqual(pick(await repo.put({ record: row("a", { isDefault: true, revision: 2 }), expectedRevision: 1 })), { isDefault: true, revision: 2 });
  });

  test("an explicit default does not touch a non-default sibling", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b" }), expectedRevision: null });
    await repo.put({ record: row("c", { label: "c", isDefault: true }), expectedRevision: null });
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "b" })), { isDefault: false, revision: 1 });
  });

  test("a duplicate label in the same group conflicts and writes nothing", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { label: "Same" }), expectedRevision: null });
    await assert.rejects(repo.put({ record: row("b", { label: "Same" }), expectedRevision: null }), conflict);
    assert.equal(await repo.find({ workspaceId: "ws", id: "b" }), null);
  });

  test("the same label in another group is allowed", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { label: "Same" }), expectedRevision: null });
    assert.equal((await repo.put({ record: row("b", { label: "Same", ownerKey: "other" }), expectedRevision: null })).label, "Same");
  });

  test("a CAS failure is reported before a label conflict", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { label: "Same" }), expectedRevision: null });
    await assert.rejects(repo.put({ record: row("b", { label: "Same", revision: 2 }), expectedRevision: 1 }), conflict);
    await assert.rejects(repo.put({ record: row("b", { label: "Same", revision: 3 }), expectedRevision: null }), invalidRecord);
  });

  test("moving the default to another provider promotes the old group's newest row", async () => {
    const repo = new InMemoryVaultRepo({});
    const a = await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b" }), expectedRevision: null });
    const moved = await repo.put({ record: { ...a, provider: "other", revision: 2 }, expectedRevision: 1 });
    assert.equal(moved.isDefault, true);
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "b" })), { isDefault: true, revision: 2 });
  });

  test("moving the default into an occupied group yields there", async () => {
    const repo = new InMemoryVaultRepo({});
    const a = await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { provider: "other" }), expectedRevision: null });
    assert.equal((await repo.put({ record: { ...a, isDefault: false, provider: "other", revision: 2 }, expectedRevision: 1 })).isDefault, false);
  });

  test("moving a non-default row promotes nothing in the old group", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    const b = await repo.put({ record: row("b", { label: "b" }), expectedRevision: null });
    await repo.put({ record: { ...b, provider: "other", revision: 2 }, expectedRevision: 1 });
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "a" })), { isDefault: true, revision: 1 });
  });

  test("replacing a row keeps it reachable through its singleton index", async () => {
    const repo = new InMemoryVaultRepo({});
    const a = await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: { ...a, label: "renamed", revision: 2 }, expectedRevision: 1 });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 2 });
    assert.equal(await repo.findOne({ workspaceId: "ws", kind: "vendor" }), null);
  });
});

describe("InMemoryVaultRepo promotion order", () => {
  test("equal timestamps promote the greatest UTF-8 byte ID, not UTF-16 order", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("\u{10000}", { label: "astral" }), expectedRevision: null });
    await repo.put({ record: row("￿", { label: "bmp" }), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    assert.equal((await repo.findDefault(query))?.id, "\u{10000}");
  });

  test("a newer timestamp wins over a greater ID", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b", updatedAt: "2026-10-12T00:00:00Z" }), expectedRevision: null });
    await repo.put({ record: row("z", { label: "z" }), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    assert.equal((await repo.findDefault(query))?.id, "b");
  });

  test("an older later-scanned row does not displace the winner", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b", updatedAt: "2026-10-12T00:00:00Z" }), expectedRevision: null });
    await repo.put({ record: row("z", { label: "z", updatedAt: "2026-10-01T00:00:00Z" }), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    assert.equal((await repo.findDefault(query))?.id, "b");
  });

  test("deleting the last row of a group leaves no default", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    assert.equal(await repo.findDefault(query), null);
  });

  test("deleting a non-default row promotes nothing", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b" }), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "b", expectedRevision: 1 });
    assert.deepEqual(pick(await repo.find({ workspaceId: "ws", id: "a" })), { isDefault: true, revision: 1 });
  });
});

describe("InMemoryVaultRepo singleton index", () => {
  const scoped = { workspaceId: "ws", kind: "vendor" as const };

  test("finds a row with owner and principal both unfiltered", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { principalId: "p" }), expectedRevision: null });
    assert.equal((await repo.findOne(scoped))?.id, "a");
  });

  test("finds a row filtered by owner only", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { principalId: "p" }), expectedRevision: null });
    assert.equal((await repo.findOne({ ...scoped, ownerKey: "deploy" }))?.id, "a");
  });

  test("finds a row filtered by principal only", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { principalId: "p" }), expectedRevision: null });
    assert.equal((await repo.findOne({ ...scoped, principalId: "p" }))?.id, "a");
  });

  test("finds a row filtered by owner and principal", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { principalId: "p" }), expectedRevision: null });
    assert.equal((await repo.findOne({ ...scoped, ownerKey: "deploy", principalId: "p" }))?.id, "a");
  });

  test("an explicit null principal does not match a principal-bound row", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a", { principalId: "p" }), expectedRevision: null });
    assert.equal(await repo.findOne({ ...scoped, principalId: null }), null);
  });

  test("a deleted row leaves the index, keeping its sibling", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await repo.put({ record: row("b", { label: "b" }), expectedRevision: null });
    await repo.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    assert.equal((await repo.findOne(scoped))?.id, "b");
  });

  test("returns a clone", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    (await repo.findOne(scoped))!.meta.accountLabel = "alias";
    assert.equal((await repo.findOne(scoped))?.meta.accountLabel, null);
  });
});

describe("InMemoryVaultRepo list and patch", () => {
  test("list without provider spans providers, sorted by ID", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("b"), expectedRevision: null });
    await repo.put({ record: row("a", { provider: "other" }), expectedRevision: null });
    await repo.put({ record: row("c", { label: "c" }), expectedRevision: null });
    const { provider: _omitted, ...anyProvider } = query;
    assert.deepEqual((await repo.list(anyProvider)).map(r => r.id), ["a", "b", "c"]);
  });

  test("list with provider filters to that group", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("b"), expectedRevision: null });
    await repo.put({ record: row("a", { provider: "other" }), expectedRevision: null });
    assert.deepEqual((await repo.list(query)).map(r => r.id), ["b"]);
  });

  test("patching a missing row conflicts", async () => {
    const repo = new InMemoryVaultRepo({});
    await assert.rejects(repo.patchMeta({ workspaceId: "ws", id: "a", expectedRevision: 1, patch: {}, updatedAt: "t" }), conflict);
  });
});

describe("InMemoryVaultRepo applyBatch", () => {
  test("applies put, patch and delete in order and returns each result", async () => {
    const repo = new InMemoryVaultRepo({});
    const results = await repo.applyBatch({ ops: [
      { put: { record: row("a"), expectedRevision: null } },
      { patchMeta: { workspaceId: "ws", id: "a", expectedRevision: 1, patch: { accountLabel: "x" }, updatedAt: "t" } },
      { delete: { workspaceId: "ws", id: "a", expectedRevision: 2 } },
    ] });
    assert.deepEqual(results.map(r => typeof r === "boolean" ? r : r.revision), [1, 2, true]);
    assert.equal(await repo.find({ workspaceId: "ws", id: "a" }), null);
  });

  test("a failing later op publishes none of the earlier ops", async () => {
    const repo = new InMemoryVaultRepo({});
    await assert.rejects(repo.applyBatch({ ops: [
      { put: { record: row("a"), expectedRevision: null } },
      { delete: { workspaceId: "ws", id: "a", expectedRevision: 9 } },
    ] }), conflict);
    assert.equal(await repo.find({ workspaceId: "ws", id: "a" }), null);
    assert.equal(await repo.findOne({ workspaceId: "ws", kind: "vendor" }), null);
  });

  test("a failed batch leaves the live singleton index untouched", async () => {
    const repo = new InMemoryVaultRepo({});
    await repo.put({ record: row("a"), expectedRevision: null });
    await assert.rejects(repo.applyBatch({ ops: [
      { delete: { workspaceId: "ws", id: "a", expectedRevision: 1 } },
      { patchMeta: { workspaceId: "ws", id: "missing", expectedRevision: 1, patch: {}, updatedAt: "t" } },
    ] }), conflict);
    assert.equal((await repo.findOne({ workspaceId: "ws", kind: "vendor" }))?.id, "a");
  });
});
