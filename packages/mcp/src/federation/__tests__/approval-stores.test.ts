import assert from "node:assert/strict";
import { test } from "vitest";
import { createInMemoryConversationToolApprovalStore, InMemoryExternalMcpToolApprovalRepo } from "../testing/tool-approvals.memory.js";

test("always approvals replace a fingerprint and stay isolated by opaque scope, server, and tool", async () => {
  const repo = new InMemoryExternalMcpToolApprovalRepo({});
  const row = { scope: "workspace-a", serverId: "server", toolName: "inspect", fingerprint: "first", grantedByPrincipalId: "owner", grantedAt: "2026-10-01" };
  await repo.upsert(row, { scope: row.scope });
  await repo.upsert({ ...row, fingerprint: "second" }, { scope: row.scope });
  await repo.upsert(row, { scope: "workspace-b" });
  assert.deepEqual(await repo.listByScope({}, { scope: "workspace-a" }), [{ ...row, fingerprint: "second" }]);
  assert.equal(await repo.find({ ...row, serverId: "other" }, { scope: row.scope }), null);
  assert.equal(await repo.find({ ...row, toolName: "other" }, { scope: row.scope }), null);
  assert.equal(await repo.delete(row, { scope: row.scope }), true);
  assert.equal(await repo.delete(row, { scope: row.scope }), false);
  assert.deepEqual(await repo.listByScope({}, { scope: "workspace-b" }), [{ ...row, scope: "workspace-b" }]);
});
test("conversation approvals require the exact person, conversation, connection, name, and fingerprint", async () => {
  const store = createInMemoryConversationToolApprovalStore({});
  const key = { conversationId: "chat-a", principalId: "owner", connectionId: "server", toolName: "inspect", fingerprint: "first" };
  await store.grant({ key, grantedAt: "2026-10-01" });
  assert.equal(await store.has(key), true);
  for (const changed of [
    { ...key, conversationId: "chat-b" }, { ...key, principalId: "other" },
    { ...key, connectionId: "other" }, { ...key, toolName: "other" }, { ...key, fingerprint: "second" },
  ]) assert.equal(await store.has(changed), false);
  await store.grant({ key: { ...key, fingerprint: "second" }, grantedAt: "2026-10-02" });
  assert.equal(await store.has(key), false);
  assert.equal(await store.has({ ...key, fingerprint: "second" }), true);
});

test("saved identity approvals reuse conversation grants while binding person, workspace, plugin and digest", async () => {
  const store = createInMemoryConversationToolApprovalStore({});
  const key = { conversationId: "chat-a", principalId: "owner", connectionId: 'native/workspace-a', toolName: "plugin-a", fingerprint: "digest-a" };
  await store.grant({ key, grantedAt: "2026-10-08" });
  assert.ok(store.hasIdentity);
  const { conversationId: _conversationId, ...identity } = key;
  assert.equal(await store.hasIdentity(identity), true);
  assert.equal(await store.has({ ...key, conversationId: "chat-b" }), false);
  for (const changed of [
    { ...identity, principalId: "other" }, { ...identity, connectionId: "native/workspace-b" },
    { ...identity, toolName: "plugin-b" }, { ...identity, fingerprint: "digest-b" },
  ]) assert.equal(await store.hasIdentity(changed), false);
  await store.grant({ key: { ...key, fingerprint: "digest-b" }, grantedAt: "2026-10-09" });
  assert.equal(await store.hasIdentity(identity), false);
  assert.equal(await store.hasIdentity({ ...identity, fingerprint: "digest-b" }), true);
});

// REGRESSION: fails if InMemoryExternalMcpToolApprovalRepo.upsert ignores optional.scope.
test("opaque scopes keep legacy storage-key bytes and isolate the unscoped partition", async () => {
  const repo = new InMemoryExternalMcpToolApprovalRepo({});
  const row = { serverId: "service", toolName: "inspect", fingerprint: "hash", grantedByPrincipalId: "owner", grantedAt: "time" };
  const unscopedRowWithExtraScope = { ...row, scope: "stale-input-scope", fingerprint: "unscoped" };
  await repo.upsert(row, { scope: "tenant:/opaque" });
  await repo.upsert(unscopedRowWithExtraScope);
  assert.equal((await repo.find(row, { scope: "tenant:/opaque" }))?.fingerprint, "hash");
  assert.equal((await repo.find(row))?.fingerprint, "unscoped");
  // REGRESSION: fails if upsert stores an absent scope as an own property.
  assert.deepEqual(await repo.listByScope({}), [{ ...row, fingerprint: "unscoped" }]);
  // REGRESSION: fails if approvalKey reads scope from the input instead of the options bag.
  assert.equal((await repo.find(unscopedRowWithExtraScope))?.fingerprint, "unscoped");
  const storage = Reflect.get(repo, "rows");
  assert.ok(storage instanceof Map);
  assert.deepEqual([...storage.keys()], ['["tenant:/opaque","service","inspect"]', '[null,"service","inspect"]']);
  assert.equal(await repo.delete(unscopedRowWithExtraScope), true);
  assert.equal((await repo.find(row, { scope: "tenant:/opaque" }))?.fingerprint, "hash");
});
