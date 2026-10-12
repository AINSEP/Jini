import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { SecretsVaultService, InMemoryVaultRepo, buildVaultAad, createVaultMetaParsers, isCopyableKind,
  VAULT_KINDS, VaultError, type VaultIdentity, type VaultMeta, type VaultMetaParsers, type VaultPutInput, type VaultRepoPort } from "../credential-sets/index.js";

const context: VaultIdentity = { workspaceId: "ws", id: "a", kind: "site-assistant", ownerKey: "assistant", principalId: null, binding: null };
const query = { workspaceId: "ws", kind: context.kind, ownerKey: context.ownerKey, principalId: null };
const secret = "abcdefghijkl";
function fixture(parsers: VaultMetaParsers = createVaultMetaParsers({})) {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "vault-tests" });
  const sealer = new AesGcmSecretSealer({ keyring });
  const authorize = vi.fn(async () => {});
  const service = new SecretsVaultService({ repo, keyring, sealer, metaParsers: parsers, authorize,
    now: () => "2026-10-11T00:00:00.000Z", newId: () => "generated" });
  const input: VaultPutInput = { ...context, expectedRevision: null, provider: "example", label: "Main",
    meta: { model: "model-1", baseUrl: null }, payload: { token: secret }, hintToken: secret };
  return { repo, keyring, sealer, authorize, service, input };
}

test("sealed JSON round-trips with pinned tuple AAD and secret-free summaries/policy scope", async () => {
  const { repo, sealer, authorize, service, input } = fixture();
  const saved = await service.put(input);
  assert.equal(saved.revision, 1);
  assert.equal(saved.isDefault, true);
  assert.equal(saved.last4, "ijkl");
  assert.equal(saved.tokenLength, 12);
  assert.equal(saved.configured, true);
  assert.equal("sealed" in saved, false);
  assert.equal("payload" in saved, false);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(JSON.stringify(authorize.mock.calls).includes(secret), false);
  assert.equal(buildVaultAad(context), 'secrets-vault:v1:["ws","a","site-assistant","assistant",null,null]');
  const record = await repo.find(context);
  assert.ok(record?.sealed);
  assert.equal(record.sealed.ciphertext.includes(secret), false);
  assert.equal(await sealer.open({ sealed: record.sealed }, { aad: buildVaultAad(context) }), JSON.stringify(input.payload));
  assert.deepEqual((await service.get(context))?.payload, input.payload);
  assert.deepEqual(await service.list(query), [saved]);
  const noId = { ...input };
  delete noId.id;
  assert.equal((await service.put({ ...noId, label: "Generated" })).id, "generated");
});

test("hint boundary, URI exclusion and null envelope clearing preserve configuration", async () => {
  const { service, input, keyring, sealer } = fixture();
  for (const length of [0, 4, 11, 12, 20]) {
    const hintToken = "x".repeat(length);
    const saved = await service.put({ ...input, id: String(length), label: String(length), hintToken });
    assert.equal(saved.last4, length >= 12 ? "xxxx" : null);
    assert.equal(saved.tokenLength, length);
  }
  const database = await service.put({ ...input, id: "database", kind: "database-destination", meta: {}, hintToken: "postgres://user:pass@host/db" });
  assert.equal(database.last4, null);
  assert.equal(database.tokenLength, null);
  await service.put(input);
  const cleared = await service.put({ ...input, expectedRevision: 1, payload: null });
  assert.equal(cleared.configured, false);
  assert.equal(cleared.last4, null);
  assert.equal(cleared.tokenLength, null);
  assert.deepEqual(cleared.meta, input.meta);
  vi.spyOn(keyring, "activeKey").mockRejectedValue(new Error("no key"));
  const open = vi.spyOn(sealer, "open");
  assert.equal((await service.get(context))?.payload, null);
  assert.equal((await service.rotate({ ...context, expectedRevision: 2 })).configured, false);
  assert.equal(open.mock.calls.length, 0);
  assert.equal((await service.list(query)).find(row => row.id === "a")?.configured, false);
});

test("wrong expected context is rejected before opening; substituted ciphertext fails real GCM", async () => {
  const { service, input, sealer, repo } = fixture();
  await service.put(input);
  const open = vi.spyOn(sealer, "open");
  for (const changed of [{ kind: "vendor" as const }, { ownerKey: "other" }, { principalId: "other" }, { binding: "https://other" }]) {
    await assert.rejects(service.get({ ...context, ...changed }), { code: "context" });
  }
  assert.equal(open.mock.calls.length, 0);
  assert.equal(await service.get({ ...context, workspaceId: "other" }), null);
  assert.equal(await service.get({ ...context, id: "missing" }), null);
  await service.put({ ...input, id: "b", label: "Other" });
  const a = (await repo.find(context))!;
  const b = (await repo.find({ ...context, id: "b" }))!;
  await repo.put({ record: { ...b, sealed: a.sealed, revision: 2 }, expectedRevision: 1 });
  await assert.rejects(service.get({ ...context, id: "b" }));
  assert.equal((await service.list(query)).length, 2);
  // JSON tuple distinguishes delimiter-containing identifiers from shifted context parts.
  assert.notEqual(buildVaultAad({ ...context, workspaceId: "ws:a", id: "b" }), buildVaultAad({ ...context, workspaceId: "ws", id: "a:b" }));
});

test("minimal registry covers only requested kinds and rejects unknown/invalid plain metadata", () => {
  const parsers = createVaultMetaParsers({});
  assert.deepEqual(Object.keys(parsers), [...VAULT_KINDS]);
  for (const kind of VAULT_KINDS) {
    assert.deepEqual(parsers[kind]({ meta: {} }), {});
    for (const meta of [null, [], "text", { token: secret }, { constructor: "value" }]) {
      assert.throws(() => parsers[kind]({ meta }), { code: "invalid-meta" });
    }
  }
  assert.deepEqual(parsers.custom({ meta: { category: "any-host-catalog", baseUrl: "https://host", additionalHosts: [], username: null } }),
    { category: "any-host-catalog", baseUrl: "https://host", additionalHosts: [], username: null });
  assert.throws(() => parsers.custom({ meta: { additionalHosts: [123] } }), { code: "invalid-meta" });
  assert.throws(() => parsers["personal-execution"]({ meta: { maxTokens: Infinity } }), { code: "invalid-meta" });
  assert.throws(() => parsers["site-assistant"]({ meta: { model: 42 } }), { code: "invalid-meta" });
  assert.throws(() => parsers["database-destination"]({ meta: { lastRun: [] } }), { code: "invalid-meta" });
  assert.equal(isCopyableKind["personal-execution"], false);
  assert.equal(isCopyableKind["mcp-auth"], false);
  assert.equal(isCopyableKind["mcp-env"], false);
  assert.equal(typeof SecretsVaultService.prototype.copyToSite, "function");
});

test("injected policy/catalog validates put, read and merged patch with identical lifecycle", async () => {
  const parser = vi.fn(({ meta }: { meta: unknown }): VaultMeta => {
    const value = meta as VaultMeta;
    if (value.model !== "approved" || value.baseUrl !== "https://allowed") throw new VaultError({ code: "invalid-meta" });
    return value;
  });
  const withPolicy = fixture(createVaultMetaParsers({}, { parsers: { "site-assistant": parser } }));
  const baseline = fixture();
  const unapproved = { ...withPolicy.input, meta: { model: "unapproved", baseUrl: "https://allowed" } };
  await baseline.service.put(unapproved);
  await assert.rejects(withPolicy.service.put(unapproved), { code: "invalid-meta" });
  assert.equal(await withPolicy.repo.find(context), null);
  await withPolicy.service.put({ ...withPolicy.input, meta: { model: "approved", baseUrl: "https://allowed" } });
  await assert.rejects(withPolicy.service.patchMeta({ ...context, expectedRevision: 1, patch: { baseUrl: null } }), { code: "invalid-meta" });
  assert.equal((await withPolicy.repo.find(context))?.revision, 1);
  const patched = await withPolicy.service.patchMeta({ ...context, expectedRevision: 1, patch: { model: "approved" } });
  assert.equal(patched.revision, 2);
  assert.deepEqual(patched.meta, { model: "approved", baseUrl: "https://allowed" });
  assert.deepEqual(parser.mock.calls.at(-1)?.[0].meta, patched.meta);
  const record = (await withPolicy.repo.find(context))!;
  await withPolicy.repo.put({ record: { ...record, revision: 3, meta: { model: "unapproved", baseUrl: "https://allowed" } }, expectedRevision: 2 });
  await assert.rejects(withPolicy.service.get(context), { code: "invalid-meta" });
  await assert.rejects(withPolicy.service.list(query), { code: "invalid-meta" });
});

test("rotation uses the active generation, fresh nonce and CAS while retaining payload/hints", async () => {
  const { service, keyring, input, repo } = fixture();
  await service.put(input);
  const before = (await repo.find(context))!;
  vi.spyOn(keyring, "activeKey").mockResolvedValue({ keyId: "v2" });
  const rotated = await service.rotate({ ...context, expectedRevision: 1 });
  const after = (await repo.find(context))!;
  assert.equal(after.sealed?.keyId, "v2");
  assert.notEqual(after.sealed?.nonce, before.sealed?.nonce);
  assert.equal(rotated.last4, "ijkl");
  assert.equal(rotated.revision, 2);
  assert.deepEqual((await service.get(context))?.payload, input.payload);
  await assert.rejects(service.rotate({ ...context, expectedRevision: 1 }), { code: "conflict" });
  await assert.rejects(service.put({ ...input, expectedRevision: 1 }), { code: "conflict" });
  await assert.rejects(service.patchMeta({ ...context, expectedRevision: 1, patch: { model: "changed" } }), { code: "conflict" });
  await assert.rejects(service.delete({ ...context, expectedRevision: 1 }), { code: "conflict" });
  assert.equal(await service.delete({ ...context, expectedRevision: 2 }), true);
  assert.equal(await service.delete({ ...context, expectedRevision: 2 }), false);
});

test("rotation cannot overwrite a replacement committed while sealing was pending", async () => {
  const { service, input, sealer } = fixture();
  await service.put(input);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const seal = sealer.seal.bind(sealer);
  vi.spyOn(sealer, "seal").mockImplementationOnce(async value => {
    entered();
    await pending;
    return seal(value);
  });
  const rotating = service.rotate({ ...context, expectedRevision: 1 });
  // Attach the rejection assertion before allowing either concurrent operation to finish.
  const lost = assert.rejects(rotating, { code: "conflict" });
  await started;
  await service.put({ ...input, expectedRevision: 1, payload: { token: "replacement" } });
  release();
  await lost;
  assert.deepEqual((await service.get(context))?.payload, { token: "replacement" });
});

test("authorization and sealing failures do not persist; personal access always has a principal", async () => {
  const { service, input, repo, authorize, sealer } = fixture();
  authorize.mockRejectedValue(new Error("denied"));
  await assert.rejects(service.put(input), /denied/);
  assert.equal(await repo.find(context), null);
  authorize.mockResolvedValue(undefined);
  vi.spyOn(sealer, "seal").mockRejectedValue(new Error("unavailable"));
  await assert.rejects(service.put(input), /unavailable/);
  assert.equal(await repo.find(context), null);
  await assert.rejects(service.put({ ...input, kind: "personal-execution", principalId: null }), { code: "context" });
  authorize.mockRejectedValue(new Error("denied"));
  await assert.rejects(service.get(context), /denied/);
  await assert.rejects(service.list(query), /denied/);
  await assert.rejects(service.rotate({ ...context, expectedRevision: 1 }), /denied/);
  await assert.rejects(service.delete({ ...context, expectedRevision: 1 }), /denied/);
});

test("default lookup uses one repo query and checks scope/policy before decrypting", async () => {
  const { service, input, repo, sealer, authorize } = fixture();
  await service.put(input);
  await service.put({ ...input, id: "b", label: "Other" });
  const record = (await repo.find(context))!;
  vi.spyOn(repo, "list").mockRejectedValue(new Error("must not list"));
  vi.spyOn(repo, "find").mockRejectedValue(new Error("must not refetch"));
  const findDefault = vi.spyOn(repo, "findDefault");
  const defaultQuery = { ...query, provider: "example", binding: null };
  assert.deepEqual((await service.findDefault(defaultQuery))?.payload, input.payload);
  assert.equal(findDefault.mock.calls.length, 1);
  assert.equal(await service.findDefault({ ...defaultQuery, provider: null }), null);
  const open = vi.spyOn(sealer, "open");
  for (const changed of [{ binding: "other" }, { provider: "other" }, { ownerKey: "other" }, { principalId: "other" }]) {
    findDefault.mockResolvedValueOnce(record);
    await assert.rejects(service.findDefault({ ...defaultQuery, ...changed }), { code: "context" });
  }
  assert.equal(open.mock.calls.length, 0);
  findDefault.mockResolvedValueOnce({ ...record, isDefault: false });
  await assert.rejects(service.findDefault(defaultQuery), { code: "context" });
  const reads = findDefault.mock.calls.length;
  authorize.mockRejectedValue(new Error("denied"));
  await assert.rejects(service.findDefault(defaultQuery), /denied/);
  assert.equal(findDefault.mock.calls.length, reads);
});

test("pre-C1 repo ports keep put/get working and never fall back to group reads for defaults", async () => {
  const { repo, keyring, sealer, authorize, input } = fixture();
  const legacy: VaultRepoPort = { find: repo.find.bind(repo), list: repo.list.bind(repo), put: repo.put.bind(repo),
    patchMeta: repo.patchMeta.bind(repo), delete: repo.delete.bind(repo) };
  const service = new SecretsVaultService({ repo: legacy, keyring, sealer, authorize, metaParsers: createVaultMetaParsers({}),
    now: () => "2026-10-11T00:00:00Z", newId: () => "generated" });
  await service.put(input);
  assert.deepEqual((await service.get(context))?.payload, input.payload);
  const list = vi.spyOn(legacy, "list");
  await assert.rejects(service.findDefault({ ...query, provider: "example", binding: null }), { code: "invalid-record" });
  assert.equal(list.mock.calls.length, 0);
  await assert.rejects(service.findOne(context), { code: "invalid-record" });
  const prepared = await service.prepare({ ...input, id: "prepared", label: "Prepared" });
  await assert.rejects(service.commitPrepared({ records: [prepared], deletes: [], expectedRevisions: { prepared: null } }), { code: "invalid-record" });
  assert.equal(await repo.find({ ...context, id: "prepared" }), null);
});

test("singleton reads ignore provider/default, use one query and reject substituted ownership before open", async () => {
  for (const kind of ["site-assistant", "personal-execution", "database-destination"] as const) {
    const { service, repo, input, sealer, authorize } = fixture();
    const scope = { ...context, kind, principalId: kind === "personal-execution" ? "person" : null };
    await service.put({ ...input, ...scope, meta: {} });
    const initial = (await repo.find(scope))!;
    const record = await repo.put({ record: { ...initial, isDefault: false, revision: 2 }, expectedRevision: 1 });
    vi.spyOn(repo, "find").mockRejectedValue(new Error("must not refetch"));
    vi.spyOn(repo, "list").mockRejectedValue(new Error("must not list"));
    const findOne = vi.spyOn(repo, "findOne");
    const result = await service.findOne(scope);
    assert.deepEqual(result?.payload, input.payload);
    assert.equal(result?.summary.isDefault, false);
    assert.equal(findOne.mock.calls.length, 1);
    assert.equal(await service.findOne({ ...scope, workspaceId: "missing" }), null);
    const open = vi.spyOn(sealer, "open");
    for (const patch of [{ ownerKey: "wrong" }, { principalId: "wrong" }, { binding: "wrong" }, { workspaceId: "wrong" }]) {
      findOne.mockResolvedValueOnce(record);
      await assert.rejects(service.findOne({ ...scope, ...patch }), { code: "context" });
    }
    assert.equal(open.mock.calls.length, 0);
    const reads = findOne.mock.calls.length;
    authorize.mockRejectedValue(new Error("denied"));
    await assert.rejects(service.findOne(scope), /denied/);
    assert.equal(findOne.mock.calls.length, reads);
  }
});

test("provider moves preserve envelope, identity and hints, promote the old group and reopen with unchanged AAD", async () => {
  const { service, repo, input, sealer } = fixture();
  await service.put(input);
  await service.put({ ...input, id: "b", label: "Sibling" });
  await service.put({ ...input, id: "target", label: "Target", provider: "other" });
  const before = (await repo.find(context))!;
  const seal = vi.spyOn(sealer, "seal");
  const open = vi.spyOn(sealer, "open");
  const moved = await service.put({ ...input, payload: undefined, expectedRevision: 1, provider: "other", isDefault: false });
  const after = (await repo.find(context))!;
  assert.deepEqual(after.sealed, before.sealed);
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.binding, before.binding);
  assert.equal(buildVaultAad(after), buildVaultAad(before));
  assert.equal(after.last4, before.last4);
  assert.equal(after.tokenLength, before.tokenLength);
  assert.equal(moved.isDefault, false);
  assert.equal(seal.mock.calls.length, 0);
  assert.equal(open.mock.calls.length, 0);
  assert.equal((await repo.findDefault({ ...query, provider: "example" }))?.id, "b");
  assert.equal((await repo.find({ ...context, id: "b" }))?.revision, 2);
  assert.equal((await repo.findDefault({ ...query, provider: "other" }))?.id, "target");
  assert.deepEqual((await service.get(context))?.payload, input.payload);
  await assert.rejects(service.put({ ...input, payload: undefined, expectedRevision: 1, provider: null }), { code: "conflict" });
  // Empty destination groups retain the existing first-row default rule even with false input.
  assert.equal((await service.put({ ...input, payload: undefined, expectedRevision: 2, provider: null, isDefault: false })).isDefault, true);
  assert.equal((await service.put({ ...input, payload: undefined, expectedRevision: 3, provider: "other" })).isDefault, false);
  assert.equal((await repo.findDefault({ ...query, provider: "other" }))?.id, "target");
  assert.deepEqual((await repo.find(context))?.sealed, before.sealed);
});

test("prepare selects identity and seals without persistence; commit reauthorizes and never re-seals", async () => {
  const { service, repo, input, sealer, authorize } = fixture();
  const put = vi.spyOn(repo, "put");
  const { id: _id, ...newInput } = input;
  const prepared = await service.prepare(newInput);
  assert.equal(prepared.id, "generated");
  assert.equal(prepared.revision, 1);
  assert.equal(prepared.last4, "ijkl");
  assert.equal(prepared.tokenLength, 12);
  assert.ok(prepared.sealed);
  assert.equal(put.mock.calls.length, 0);
  assert.equal(await repo.find(prepared), null);
  const seal = vi.spyOn(sealer, "seal");
  const open = vi.spyOn(sealer, "open");
  const summaries = await service.commitPrepared({ records: [prepared], deletes: [], expectedRevisions: { generated: null } });
  assert.equal(summaries[0]?.id, prepared.id);
  assert.equal(summaries[0]?.configured, true);
  assert.equal("sealed" in summaries[0]!, false);
  assert.equal(seal.mock.calls.length, 0);
  assert.equal(open.mock.calls.length, 0);
  assert.deepEqual((await repo.find(prepared))?.sealed, prepared.sealed);
  assert.deepEqual((await service.get(prepared))?.payload, input.payload);
  assert.equal(JSON.stringify(authorize.mock.calls).includes(secret), false);
  // A record is structurally a VaultIdentity: extra fields must not turn a delete into a put.
  assert.deepEqual(await service.commitPrepared({ records: [], deletes: [prepared], expectedRevisions: { generated: 1 } }), []);
  assert.equal(await repo.findOne(query), null);
  await assert.rejects(service.prepare({ ...input, payload: undefined }), { code: "invalid-record" });
});

test("commitPrepared rolls back a late label conflict including earlier default and index changes", async () => {
  const { service, repo, input } = fixture();
  await service.put(input);
  const original = await repo.list(query);
  const records = await Promise.all(["b", "c"].map(id => service.prepare({ ...input, id, label: "Batch", isDefault: true })));
  await assert.rejects(service.commitPrepared({ records, deletes: [], expectedRevisions: { b: null, c: null } }), { code: "conflict" });
  assert.deepEqual(await repo.list(query), original);
  assert.equal((await repo.findOne(query))?.id, "a");
  assert.equal(await repo.find({ ...context, id: "b" }), null);
});

test("commitPrepared rejects missing revisions, duplicate identities, metadata/context tampering and denied policy before writes", async () => {
  const { service, repo, input, authorize } = fixture();
  const record = await service.prepare(input);
  const batch = vi.spyOn(repo, "applyBatch");
  await assert.rejects(service.commitPrepared({ records: [record], deletes: [], expectedRevisions: {} }), { code: "invalid-record" });
  await assert.rejects(service.commitPrepared({ records: [record, record], deletes: [], expectedRevisions: { a: null } }), { code: "invalid-record" });
  await assert.rejects(service.commitPrepared({ records: [{ ...record, meta: { token: secret } }], deletes: [], expectedRevisions: { a: null } }), { code: "invalid-meta" });
  authorize.mockRejectedValueOnce(new Error("denied"));
  await assert.rejects(service.commitPrepared({ records: [record], deletes: [], expectedRevisions: { a: null } }), /denied/);
  assert.equal(batch.mock.calls.length, 0);
  assert.equal(await repo.find(context), null);
  await service.put(input);
  const replacement = await service.prepare({ ...input, expectedRevision: 1, payload: undefined });
  await assert.rejects(service.commitPrepared({ records: [{ ...replacement, binding: "wrong" }], deletes: [], expectedRevisions: { a: 1 } }), { code: "context" });
  assert.equal((await repo.find(context))?.revision, 1);
  assert.equal(batch.mock.calls.length, 0);
});

test("a prepared replacement cannot overwrite a replacement committed while preparation was sealing", async () => {
  const { service, repo, input, sealer } = fixture();
  await service.put(input);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const seal = sealer.seal.bind(sealer);
  vi.spyOn(sealer, "seal").mockImplementationOnce(async value => { entered(); await pending; return seal(value); });
  const preparing = service.prepare({ ...input, expectedRevision: 1, payload: { token: "prepared-old" } });
  await started;
  await service.put({ ...input, expectedRevision: 1, payload: { token: "concurrent-new" } });
  const winner = await repo.find(context);
  release();
  const record = await preparing;
  await assert.rejects(service.commitPrepared({ records: [record], deletes: [], expectedRevisions: { a: 1 } }), { code: "conflict" });
  assert.deepEqual(await repo.find(context), winner);
  assert.deepEqual((await service.get(context))?.payload, { token: "concurrent-new" });
});
