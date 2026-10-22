/** C1 copyplan + coordinator REVIEW: real site keys, immutable identities and secret-free outcomes. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers, buildVaultAad, VAULT_KINDS,
  isCopyableKind, type VaultContext, type VaultCopyInput, type VaultMeta, type VaultPutInput } from "../credential-sets/index.js";

const token = "a-secret-key-12345678";
const address = "postgres://user:password@host/db";
function fixture(site: string) {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "copy-tests" }, { keyId: site });
  const sealer = new AesGcmSecretSealer({ keyring });
  const authorize = vi.fn(async () => {});
  const service = new SecretsVaultService({ repo, keyring, sealer, authorize, metaParsers: createVaultMetaParsers({}),
    now: () => "2026-10-11T00:00:00Z", newId: () => "generated" });
  const context: VaultContext = { workspaceId: site, kind: "vendor", ownerKey: "feature", principalId: null, binding: null };
  const input: VaultPutInput = { ...context, id: "same-id", provider: "host", label: "Main",
    meta: { credentialType: "vendor", worksFor: ["host"] }, payload: { token }, hintToken: token, expectedRevision: null };
  return { service, repo, keyring, sealer, authorize, context, input };
}
function transfer(source: ReturnType<typeof fixture>, target: ReturnType<typeof fixture>, patch: Partial<VaultCopyInput> = {}): VaultCopyInput {
  return { source: source.service, sourceContext: source.context, targetContext: target.context, ids: ["same-id"], overwrite: false, ...patch };
}

test("every eligible kind keeps IDs and payloads, changes key/AAD, and returns only safe fields", async () => {
  for (const kind of VAULT_KINDS.filter(kind => isCopyableKind[kind])) {
    const source = fixture("source"), target = fixture("target");
    source.context.kind = target.context.kind = kind;
    const payload: VaultMeta = kind === "database-destination" ? { connectionString: address } : { token };
    await source.service.put({ ...source.input, ...source.context, meta: kind === "vendor" ? source.input.meta : {}, payload });
    const before = (await source.repo.find({ workspaceId: "source", id: "same-id" }))!;
    const copied = await target.service.copyToSite(transfer(source, target));
    assert.deepEqual(copied, [{ kind, id: "same-id", status: "copied", ...(kind === "database-destination" ? {} : { last4: "5678" }) }]);
    const after = (await target.repo.find({ workspaceId: "target", id: "same-id" }))!;
    assert.equal(after.id, before.id);
    assert.equal(after.sealed?.keyId, "target");
    assert.notEqual(after.sealed?.nonce, before.sealed?.nonce);
    assert.notEqual(after.sealed?.ciphertext, before.sealed?.ciphertext);
    assert.notEqual(buildVaultAad(before), buildVaultAad(after));
    assert.deepEqual((await target.service.get({ ...target.context, id: after.id }))?.payload, payload);
    await assert.rejects(target.sealer.open({ sealed: before.sealed! }, { aad: buildVaultAad(before) }));
    await assert.rejects(target.sealer.open({ sealed: after.sealed! }, { aad: buildVaultAad(before) }));
    assert.deepEqual(await source.repo.find(before), before);
    for (const value of [token, address, before.sealed?.ciphertext, after.sealed?.ciphertext]) {
      if (value) assert.equal(JSON.stringify(copied).includes(value), false);
    }
    assert.equal(JSON.stringify([...source.authorize.mock.calls, ...target.authorize.mock.calls]).includes(token), false);
  }
});

test("existing IDs skip without opening; overwrite retains target default and creation time", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put(source.input);
  await target.service.put({ ...target.input, id: "default", label: "Target default" });
  await target.service.put({ ...target.input, payload: { token: "target-value" } });
  const before = (await target.repo.find({ workspaceId: "target", id: "same-id" }))!;
  const open = vi.spyOn(source.sealer, "open");
  assert.deepEqual(await target.service.copyToSite(transfer(source, target)),
    [{ kind: "vendor", id: "same-id", status: "skipped", reasonCode: "target-exists" }]);
  assert.equal(open.mock.calls.length, 0);
  assert.deepEqual(await target.repo.find(before), before);
  assert.equal((await target.service.copyToSite(transfer(source, target, { overwrite: true })))[0]?.status, "copied");
  const after = (await target.repo.find(before))!;
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.isDefault, false);
  assert.equal((await target.repo.findDefault({ ...target.context, provider: "host" }))?.id, "default");
  assert.deepEqual((await target.service.get({ ...target.context, id: "same-id" }))?.payload, { token });
});

test("excluded kinds and legacy AAD rows never open; mixed batches deduplicate and keep safe failures", async () => {
  const source = fixture("source"), target = fixture("target");
  const open = vi.spyOn(source.sealer, "open");
  for (const kind of ["personal-execution", "mcp-auth", "mcp-env"] as const) {
    const context = { ...source.context, kind, principalId: kind === "personal-execution" ? "source-person" : null };
    const result = await target.service.copyToSite(transfer(source, target, { sourceContext: context, targetContext: { ...context, workspaceId: "target" } }));
    assert.deepEqual(result, [{ kind, id: "same-id", status: "skipped",
      reasonCode: kind === "mcp-env" ? "requires-mcp-configuration" : "kind-not-copyable" }]);
  }
  await source.service.put(source.input);
  const row = (await source.repo.find({ workspaceId: "source", id: "same-id" }))!;
  await source.repo.put({ record: { ...row, id: "legacy", label: "Legacy", meta: { legacyAad: { aadVersion: 0 } } }, expectedRevision: null });
  assert.deepEqual(await target.service.copyToSite(transfer(source, target, { ids: ["legacy", "missing", "same-id", "same-id"] })), [
    { kind: "vendor", id: "legacy", status: "failed", reasonCode: "source-needs-upgrade" },
    { kind: "vendor", id: "missing", status: "failed", reasonCode: "source-missing" },
    { kind: "vendor", id: "same-id", status: "copied", last4: "5678" },
  ]);
  assert.equal(open.mock.calls.length, 1);
  assert.equal(await target.repo.find({ workspaceId: "target", id: "legacy" }), null);
});

test("both policies and expected contexts guard opening; label conflicts and stale selections fail safely", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put(source.input);
  const open = vi.spyOn(source.sealer, "open");
  assert.equal((await source.service.copyToSite(transfer(source, source, { overwrite: true })))[0]?.reasonCode, "context");
  assert.equal((await source.repo.find({ workspaceId: "source", id: "same-id" }))?.revision, 1);
  for (const authorize of [source.authorize, target.authorize]) {
    authorize.mockRejectedValueOnce(new Error(`denied ${token}`));
    assert.deepEqual(await target.service.copyToSite(transfer(source, target)),
      [{ kind: "vendor", id: "same-id", status: "failed", reasonCode: "copy-failed" }]);
  }
  for (const patch of [{ ownerKey: "other" }, { binding: "https://other" }, { principalId: "target-person" }]) {
    const result = await target.service.copyToSite(transfer(source, target, { targetContext: { ...target.context, ...patch } }));
    assert.equal(result[0]?.reasonCode, "context");
  }
  const result = await target.service.copyToSite(transfer(source, target, {
    sourceContext: { ...source.context, binding: "https://other" }, targetContext: { ...target.context, binding: "https://other" } }));
  assert.equal(result[0]?.reasonCode, "context");
  assert.equal((await target.service.copyToSite(transfer(source, target, { sourceRevisions: { "same-id": 2 } })))[0]?.reasonCode, "conflict");
  assert.equal(open.mock.calls.length, 0);
  await target.service.put({ ...target.input, id: "collision" });
  assert.equal((await target.service.copyToSite(transfer(source, target)))[0]?.reasonCode, "conflict");
  assert.equal(await target.repo.find({ workspaceId: "target", id: "same-id" }), null);
  assert.deepEqual((await target.service.get({ ...target.context, id: "collision" }))?.payload, { token });
});

test("overwrite CAS cannot clobber a replacement that commits while resealing", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put(source.input);
  await target.service.put(target.input);
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const seal = target.sealer.seal.bind(target.sealer);
  vi.spyOn(target.sealer, "seal").mockImplementationOnce(async input => { entered(); await pending; return seal(input); });
  const copying = target.service.copyToSite(transfer(source, target, { overwrite: true }));
  await started;
  await target.service.put({ ...target.input, expectedRevision: 1, payload: { token: "winner" } });
  release();
  assert.deepEqual(await copying, [{ kind: "vendor", id: "same-id", status: "failed", reasonCode: "conflict" }]);
  assert.deepEqual((await target.service.get({ ...target.context, id: "same-id" }))?.payload, { token: "winner" });
});

test("metadata-only rows, short hints and corrupt envelopes keep outcomes free of secret material", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put({ ...source.input, payload: null });
  assert.deepEqual(await target.service.copyToSite(transfer(source, target)), [{ kind: "vendor", id: "same-id", status: "copied" }]);
  assert.equal((await target.service.get({ ...target.context, id: "same-id" }))?.payload, null);
  await source.service.put({ ...source.input, id: "short", label: "Short", payload: { token: "short" }, hintToken: "short" });
  assert.deepEqual(await target.service.copyToSite(transfer(source, target, { ids: ["short"] })), [{ kind: "vendor", id: "short", status: "copied" }]);
  const row = (await source.repo.find({ workspaceId: "source", id: "short" }))!;
  await source.repo.put({ record: { ...row, revision: 2, sealed: { ...row.sealed!, ciphertext: token } }, expectedRevision: 1 });
  assert.deepEqual(await target.service.copyToSite(transfer(source, target, { ids: ["short"], overwrite: true })),
    [{ kind: "vendor", id: "short", status: "failed", reasonCode: "copy-failed" }]);
  assert.deepEqual((await target.service.get({ ...target.context, id: "short" }))?.payload, { token: "short" });
});

test("custom subtype and explicit compatibility survive copy, while overwrite cannot change subtype", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put({ ...source.input, provider: null,
    meta: { credentialType: "custom", worksFor: ["vercel", "github-pages"], category: "api" } });
  assert.equal((await target.service.copyToSite(transfer(source, target)))[0]?.status, "copied");
  const copied = (await target.repo.find({ workspaceId: "target", id: "same-id" }))!;
  assert.deepEqual(copied.meta, { credentialType: "custom", worksFor: ["vercel", "github-pages"], category: "api" });
  assert.deepEqual((await target.service.get({ ...target.context, id: "same-id" }))?.payload, { token });
  assert.equal((await target.service.copyToSite(transfer(source, target, { overwrite: true })))[0]?.status, "copied");
  const other = fixture("other");
  // Keep the same provider group so this assertion specifically exercises subtype immutability.
  await other.service.put({ ...other.input, provider: null });
  const before = await other.repo.find({ workspaceId: "other", id: "same-id" });
  const open = vi.spyOn(source.sealer, "open");
  assert.equal((await other.service.copyToSite(transfer(source, other, { overwrite: true })))[0]?.reasonCode, "context");
  assert.deepEqual(await other.repo.find({ workspaceId: "other", id: "same-id" }), before);
  assert.equal(open.mock.calls.length, 0);
});

test("pre-unification vendor metadata needs a source upgrade before copy can open it", async () => {
  const source = fixture("source"), target = fixture("target");
  await source.service.put(source.input);
  const row = (await source.repo.find({ workspaceId: "source", id: "same-id" }))!;
  // Synthetic historical source bypasses active parsing exactly as an old database would.
  await source.repo.put({ record: { ...row, id: "old", label: "Old", meta: {} }, expectedRevision: null });
  const open = vi.spyOn(source.sealer, "open");
  assert.deepEqual(await target.service.copyToSite(transfer(source, target, { ids: ["old"] })),
    [{ kind: "vendor", id: "old", status: "failed", reasonCode: "source-needs-upgrade" }]);
  assert.equal(open.mock.calls.length, 0);
  assert.equal(await target.repo.find({ workspaceId: "target", id: "old" }), null);
});
