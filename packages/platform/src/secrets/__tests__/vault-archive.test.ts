import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryKeyring } from "../keyring.memory.js";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers, buildVaultAad } from "../credential-sets/index.js";
import { captureVaultArchive, prepareVaultArchiveRestore } from "../credential-sets/vault-archive.js";

function fixture(workspaceId: string) {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "archive-test" }, { keyId: workspaceId });
  const sealer = new AesGcmSecretSealer({ keyring });
  const vault = new SecretsVaultService({ repo, keyring, sealer, metaParsers: createVaultMetaParsers({}), authorize: async () => {},
    now: () => "2026-10-31T00:00:00Z", newId: () => "unused" });
  const scope = { workspaceId, kind: "vendor" as const, ownerKey: "host", principalId: null, binding: null };
  const put = { ...scope, id: "key", expectedRevision: null, provider: "provider", label: "Main", meta: { credentialType: "vendor", worksFor: ["provider"] }, payload: { token: "private-provider-token" } };
  return { repo, keyring, sealer, vault, scope, put };
}

test("archive uses logical payloads and prepares fresh recipient envelopes without publishing partial writes", async () => {
  const source = fixture("source"), target = fixture("recipient");
  await source.vault.put(source.put);
  const before = (await source.repo.find({ workspaceId: "source", id: "key" }))!;
  const captured = await captureVaultArchive({ vault: source.vault, queries: [source.scope] });
  assert.equal(captured.entries.length, 1);
  assert.deepEqual(captured.notices, []);
  assert.equal(JSON.stringify(captured).includes(before.sealed!.ciphertext), false);
  assert.equal(JSON.stringify(captured).includes("source"), false);
  const records = await prepareVaultArchiveRestore({ vault: target.vault, workspaceId: "recipient", entries: captured.entries });
  assert.equal(await target.repo.find({ workspaceId: "recipient", id: "key" }), null);
  await target.repo.applyBatch!({ ops: records.map(record => ({ put: { record, expectedRevision: null } })) });
  assert.deepEqual((await target.vault.get({ ...target.scope, id: "key" }))?.payload, source.put.payload);
  assert.notEqual(records[0]!.sealed!.ciphertext, before.sealed!.ciphertext);
  await assert.rejects(source.sealer.open({ sealed: records[0]!.sealed! }, { aad: buildVaultAad(records[0]!) }));
}, 10000);

test("personal and MCP scopes cannot be archived; unreadable rows emit no secret-bearing diagnostics", async () => {
  const source = fixture("source");
  for (const kind of ["personal-execution", "mcp-env", "mcp-auth"] as const) {
    await assert.rejects(captureVaultArchive({ vault: source.vault, queries: [{ ...source.scope, kind }] }));
  }
  await source.vault.put(source.put);
  const row = (await source.repo.find({ workspaceId: "source", id: "key" }))!;
  const other = fixture("lost-key");
  const sealed = await other.sealer.seal({ plaintext: JSON.stringify(source.put.payload), key: await other.keyring.activeKey({}), aad: buildVaultAad(row) });
  await source.repo.put({ record: { ...row, revision: 2, sealed }, expectedRevision: 1 });
  const result = await captureVaultArchive({ vault: source.vault, queries: [source.scope] });
  assert.deepEqual(result.entries, []);
  assert.equal(result.notices.length, 1);
  assert.equal(JSON.stringify(result).includes("private-provider-token"), false);
}, 10000);

test("invalid later entry and duplicate identity reject before any recipient write", async () => {
  const source = fixture("source"), target = fixture("recipient");
  await source.vault.put(source.put);
  const { entries } = await captureVaultArchive({ vault: source.vault, queries: [source.scope] });
  await assert.rejects(prepareVaultArchiveRestore({ vault: target.vault, workspaceId: "recipient", entries: [...entries, { ...entries[0]!, id: "other", meta: { unregistered: true } }] }));
  await assert.rejects(prepareVaultArchiveRestore({ vault: target.vault, workspaceId: "recipient", entries: [...entries, ...entries] }));
  assert.deepEqual(await target.repo.list(target.scope), []);
}, 10000);

test("one unsupported row does not suppress healthy rows in the same vault scope", async () => {
  const source = fixture("source");
  await source.vault.put(source.put);
  const good = (await source.repo.find({ workspaceId: "source", id: "key" }))!;
  await source.repo.put({ record: { ...good, id: "unsupported", label: "Old", meta: { unsupported: true }, revision: 1 }, expectedRevision: null });
  const result = await captureVaultArchive({ vault: source.vault, repo: source.repo, queries: [source.scope] });
  assert.deepEqual(result.entries.map(row => row.id), ["key"]);
  assert.equal(result.notices.length, 1);
}, 10000);
