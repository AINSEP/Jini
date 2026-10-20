/** Boundary pins for SecretsVaultService refusals, hint/default rules and copy outcomes. */
import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { SecretsVaultService, InMemoryVaultRepo, buildVaultAad, createVaultMetaParsers, type VaultContext,
  type VaultCopyInput, type VaultIdentity, type VaultMetaParsers, type VaultPutInput, type VaultQuery, type VaultRecord } from "../credential-sets/index.js";

const NOW = "2026-10-11T00:00:00.000Z";
const token = "abcdefghijklmnop";
const contextError = { code: "context", message: "Secrets vault: context", name: "VaultError" };
const conflict = { code: "conflict", message: "Secrets vault: conflict", name: "VaultError" };
const invalidRecord = { code: "invalid-record", message: "Secrets vault: invalid-record", name: "VaultError" };
const invalidMeta = { code: "invalid-meta", message: "Secrets vault: invalid-meta", name: "VaultError" };

function fixture({ site = "ws", parsers = createVaultMetaParsers({}) }: { site?: string; parsers?: VaultMetaParsers } = {}) {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "pins" }, { keyId: site });
  const sealer = new AesGcmSecretSealer({ keyring });
  const authorize = vi.fn(async () => {});
  const newId = vi.fn(() => "generated");
  const now = vi.fn(() => NOW);
  const service = new SecretsVaultService({ repo, keyring, sealer, metaParsers: parsers, authorize, now, newId });
  const context: VaultIdentity = { workspaceId: site, id: "a", kind: "site-assistant", ownerKey: "owner", principalId: null, binding: null };
  const input: VaultPutInput = { ...context, expectedRevision: null, provider: "host", label: "Main", meta: {}, payload: { token }, hintToken: token };
  return { repo, keyring, sealer, authorize, newId, now, service, context, input };
}
const queryOf = (context: VaultContext): VaultQuery =>
  ({ workspaceId: context.workspaceId, kind: context.kind, ownerKey: context.ownerKey, principalId: context.principalId });

describe("context validation", () => {
  const invalid: [string, Partial<VaultContext>][] = [
    ["empty workspace", { workspaceId: "" }],
    ["non-string workspace", { workspaceId: 1 as unknown as string }],
    ["empty owner", { ownerKey: "" }],
    ["non-string owner", { ownerKey: null as unknown as string }],
    ["unknown kind", { kind: "other" as VaultContext["kind"] }],
    ["non-string principal", { principalId: 7 as unknown as string }],
    ["non-string binding", { binding: 7 as unknown as string }],
    ["personal access with empty principal", { kind: "personal-execution", principalId: "" }],
  ];
  for (const [name, change] of invalid) {
    test(`refuses ${name} before authorization`, async () => {
      const { service, authorize, input } = fixture();
      await assert.rejects(service.put({ ...input, ...change }), contextError);
      assert.equal(authorize.mock.calls.length, 0);
    });
  }

  test("accepts personal access with a principal", async () => {
    const { service, input } = fixture();
    assert.equal((await service.put({ ...input, kind: "personal-execution", principalId: "p" })).principalId, "p");
  });

  test("accepts a string binding", async () => {
    const { service, input } = fixture();
    assert.equal((await service.put({ ...input, binding: "https://host" })).binding, "https://host");
  });

  test("accepts the historical custom kind in a query", async () => {
    const { service, context } = fixture();
    assert.deepEqual(await service.list({ ...queryOf(context), kind: "custom" }), []);
  });

  test("a query without binding is valid", async () => {
    const { service, context, authorize } = fixture();
    await service.list(queryOf(context));
    assert.deepEqual(authorize.mock.calls[0], [{ action: "list", context: queryOf(context) }]);
  });
});

describe("summary hints", () => {
  async function stored(patch: Partial<VaultRecord>) {
    const { service, repo, input, context } = fixture();
    await service.put(input);
    const record = (await repo.find(context))!;
    await repo.put({ record: { ...record, ...patch, revision: 2 }, expectedRevision: 1 });
    return (await service.list(queryOf(context)))[0]!;
  }

  test("a long token with no stored suffix reports no suffix", async () => {
    assert.equal((await stored({ last4: null, tokenLength: 12 })).last4, null);
  });

  test("a short token never reports its stored suffix", async () => {
    assert.equal((await stored({ last4: "wxyz", tokenLength: 11 })).last4, null);
  });

  test("an over-long stored suffix is trimmed to four characters", async () => {
    assert.equal((await stored({ last4: "123456", tokenLength: 12 })).last4, "3456");
  });

  test("an unknown token length reports no suffix", async () => {
    assert.equal((await stored({ last4: "wxyz", tokenLength: null })).last4, null);
  });

  test("a row without an envelope is not configured", async () => {
    assert.equal((await stored({ sealed: null })).configured, false);
  });
});

describe("payload sealing and opening", () => {
  test("refuses an array payload without persisting", async () => {
    const { service, repo, input, context } = fixture();
    await assert.rejects(service.put({ ...input, payload: [] as unknown as VaultPutInput["payload"] }), invalidRecord);
    assert.equal(await repo.find(context), null);
  });

  test("refuses a string payload", async () => {
    const { service, input } = fixture();
    await assert.rejects(service.put({ ...input, payload: "raw" as unknown as VaultPutInput["payload"] }), invalidRecord);
  });

  for (const [name, plaintext] of [["non-JSON", "not json"], ["JSON null", "null"], ["JSON array", "[]"], ["JSON string", '"x"']] as const) {
    test(`refuses to return a ${name} plaintext`, async () => {
      const { service, repo, sealer, keyring, input, context } = fixture();
      await service.put(input);
      const record = (await repo.find(context))!;
      const sealed = await sealer.seal({ plaintext, key: await keyring.activeKey({}), aad: buildVaultAad(context) });
      await repo.put({ record: { ...record, sealed, revision: 2 }, expectedRevision: 1 });
      await assert.rejects(service.get(context), invalidRecord);
    });
  }

  test("a cleared envelope reads back as a null payload", async () => {
    const { service, input, context } = fixture();
    await service.put({ ...input, payload: null });
    assert.equal((await service.get(context))?.payload, null);
  });
});

describe("prepare", () => {
  test("a replacement without an ID conflicts after authorization", async () => {
    const { service, input, authorize } = fixture();
    const { id: _omitted, ...withoutId } = input;
    await assert.rejects(service.prepare({ ...withoutId, expectedRevision: 1 }), conflict);
    assert.equal(authorize.mock.calls.length, 1);
  });

  test("creation without an ID takes the injected ID", async () => {
    const { service, input, newId } = fixture();
    const { id: _omitted, ...withoutId } = input;
    assert.equal((await service.prepare(withoutId)).id, "generated");
    assert.equal(newId.mock.calls.length, 1);
  });

  test("a supplied ID never asks for a new one", async () => {
    const { service, input, newId } = fixture();
    await service.prepare(input);
    assert.equal(newId.mock.calls.length, 0);
  });

  test("creating over an existing row conflicts", async () => {
    const { service, input } = fixture();
    await service.put(input);
    await assert.rejects(service.prepare(input), conflict);
  });

  test("replacing a missing row conflicts", async () => {
    const { service, input } = fixture();
    await assert.rejects(service.prepare({ ...input, expectedRevision: 1 }), conflict);
  });

  test("replacing at a stale revision conflicts", async () => {
    const { service, input } = fixture();
    await service.put(input);
    await assert.rejects(service.prepare({ ...input, expectedRevision: 2 }), conflict);
  });

  for (const [name, meta] of [["null", null], ["a string", "meta"], ["no subtype", { worksFor: [] }], ["no works-for", { credentialType: "vendor" }]] as const) {
    test(`new vendor credential with ${name} metadata is invalid`, async () => {
      const { service, input } = fixture();
      await assert.rejects(service.prepare({ ...input, kind: "vendor", meta }), invalidMeta);
    });
  }

  test("preparing a vendor replacement that changes subtype is refused before sealing", async () => {
    const { service, input, sealer } = fixture();
    const vendor = { ...input, kind: "vendor" as const, meta: { credentialType: "vendor", worksFor: [] } };
    await service.put(vendor);
    const seal = vi.spyOn(sealer, "seal");
    await assert.rejects(service.prepare({ ...vendor, expectedRevision: 1, meta: { credentialType: "custom", worksFor: [] } }), contextError);
    assert.equal(seal.mock.calls.length, 0);
  });

  test("creation without a payload is an invalid record", async () => {
    const { service, input } = fixture();
    const { payload: _omitted, ...withoutPayload } = input;
    await assert.rejects(service.prepare(withoutPayload), invalidRecord);
  });

  test("an omitted payload on replacement keeps envelope and hints", async () => {
    const { service, input, repo, context } = fixture();
    await service.put(input);
    const before = (await repo.find(context))!;
    const { payload: _omitted, ...withoutPayload } = input;
    const prepared = await service.prepare({ ...withoutPayload, expectedRevision: 1, hintToken: "zzzzzzzzzzzzzzzz" });
    assert.deepEqual([prepared.sealed, prepared.last4, prepared.tokenLength], [before.sealed, before.last4, before.tokenLength]);
  });

  test("a null payload clears envelope and hints even with a hint token", async () => {
    const { service, input } = fixture();
    const prepared = await service.prepare({ ...input, payload: null });
    assert.deepEqual([prepared.sealed, prepared.last4, prepared.tokenLength], [null, null, null]);
  });

  test("a sealed payload without a hint token has no hints", async () => {
    const { service, input } = fixture();
    const { hintToken: _omitted, ...withoutHint } = input;
    const prepared = await service.prepare(withoutHint);
    assert.deepEqual([prepared.sealed !== null, prepared.last4, prepared.tokenLength], [true, null, null]);
  });

  test("a sealed payload with a hint token records its suffix and length", async () => {
    const { service, input } = fixture();
    const prepared = await service.prepare(input);
    assert.deepEqual([prepared.last4, prepared.tokenLength], ["mnop", 16]);
  });

  for (const kind of ["database-destination", "mcp-env", "mcp-auth"] as const) {
    test(`${kind} never records a hint`, async () => {
      const { service, input } = fixture();
      const prepared = await service.prepare({ ...input, kind });
      assert.deepEqual([prepared.last4, prepared.tokenLength], [null, null]);
    });
  }

  test("creation sets revision 1 and both timestamps to now", async () => {
    const { service, input } = fixture();
    const prepared = await service.prepare(input);
    assert.deepEqual([prepared.revision, prepared.createdAt, prepared.updatedAt, prepared.isDefault], [1, NOW, NOW, false]);
  });

  test("replacement keeps createdAt and the same-group default", async () => {
    const { service, input, now } = fixture();
    now.mockReturnValueOnce("earlier");
    await service.put(input);
    const prepared = await service.prepare({ ...input, expectedRevision: 1 });
    assert.deepEqual([prepared.revision, prepared.createdAt, prepared.updatedAt, prepared.isDefault], [2, "earlier", NOW, true]);
  });

  test("a provider move starts as non-default", async () => {
    const { service, input } = fixture();
    await service.put(input);
    assert.equal((await service.prepare({ ...input, expectedRevision: 1, provider: "other" })).isDefault, false);
  });

  test("a non-default replacement stays non-default", async () => {
    const { service, input } = fixture();
    await service.put(input);
    await service.put({ ...input, id: "b", label: "Other" });
    assert.equal((await service.prepare({ ...input, id: "b", label: "Other", expectedRevision: 1 })).isDefault, false);
  });

  test("an explicit default flag wins", async () => {
    const { service, input } = fixture();
    await service.put(input);
    assert.equal((await service.prepare({ ...input, expectedRevision: 1, isDefault: false })).isDefault, false);
  });
});

describe("list scope check", () => {
  const changes: [string, Partial<VaultRecord>][] = [
    ["workspace", { workspaceId: "other" }], ["kind", { kind: "media-provider" }], ["owner", { ownerKey: "other" }],
    ["principal", { principalId: "p" }], ["provider", { provider: "other" }],
  ];
  for (const [name, change] of changes) {
    test(`refuses a listed row from another ${name}`, async () => {
      const { service, input, repo, context } = fixture();
      await service.put(input);
      const record = (await repo.find(context))!;
      vi.spyOn(repo, "list").mockResolvedValue([{ ...record, ...change }]);
      await assert.rejects(service.list({ ...queryOf(context), provider: "host" }), contextError);
    });
  }

  test("an omitted provider accepts rows of any provider", async () => {
    const { service, input, repo, context } = fixture();
    await service.put(input);
    const record = (await repo.find(context))!;
    vi.spyOn(repo, "list").mockResolvedValue([{ ...record, provider: "other" }]);
    assert.equal((await service.list(queryOf(context)))[0]?.provider, "other");
  });
});

describe("patchMeta", () => {
  test("refuses a parser that drops an existing key", async () => {
    const base = createVaultMetaParsers({});
    const parsers: VaultMetaParsers = { ...base, "site-assistant": ({ meta }) => {
      const { model: _dropped, ...rest } = meta as Record<string, null>;
      return rest;
    } };
    const { service, input, context } = fixture({ parsers });
    await service.put({ ...input, meta: {} });
    await assert.rejects(service.patchMeta({ ...context, expectedRevision: 1, patch: { model: "m" } }), invalidMeta);
  });

  test("a missing row conflicts", async () => {
    const { service, context } = fixture();
    await assert.rejects(service.patchMeta({ ...context, expectedRevision: 1, patch: {} }), conflict);
  });

  test("sends only changed keys to the repository", async () => {
    const { service, input, repo, context } = fixture();
    await service.put({ ...input, meta: { model: "m", baseUrl: "https://a" } });
    const patchMeta = vi.spyOn(repo, "patchMeta");
    await service.patchMeta({ ...context, expectedRevision: 1, patch: { model: "m", baseUrl: "https://b" } });
    assert.deepEqual(patchMeta.mock.calls[0]?.[0], { workspaceId: "ws", id: "a", expectedRevision: 1, patch: { baseUrl: "https://b" }, updatedAt: NOW });
  });
});

describe("rotate and delete", () => {
  test("rotating a missing row conflicts", async () => {
    const { service, context } = fixture();
    await assert.rejects(service.rotate({ ...context, expectedRevision: 1 }), conflict);
  });

  test("deleting a missing row returns false", async () => {
    const { service, context } = fixture();
    assert.equal(await service.delete({ ...context, expectedRevision: 1 }), false);
  });

  test("deleting at a stale revision conflicts", async () => {
    const { service, input, context } = fixture();
    await service.put(input);
    await assert.rejects(service.delete({ ...context, expectedRevision: 2 }), conflict);
  });
});

describe("copyToSite", () => {
  async function pair({ kind = "site-assistant" as VaultContext["kind"], meta = {} as VaultPutInput["meta"] } = {}) {
    const source = fixture({ site: "source" }), target = fixture({ site: "target" });
    source.context.kind = target.context.kind = kind;
    await source.service.put({ ...source.input, kind, meta });
    const transfer = (patch: Partial<VaultCopyInput> = {}): VaultCopyInput => ({ source: source.service,
      sourceContext: source.context, targetContext: target.context, ids: ["a"], overwrite: false, ...patch });
    return { source, target, transfer };
  }
  const failed = (reasonCode: string, kind = "site-assistant") => [{ kind, id: "a", status: "failed", reasonCode }];

  const mismatches: [string, (s: VaultContext, t: VaultContext) => void][] = [
    ["kind", (_s, t) => { t.kind = "media-provider"; }],
    ["owner", (_s, t) => { t.ownerKey = "other"; }],
    ["binding", (_s, t) => { t.binding = "https://other"; }],
    ["source principal", s => { s.principalId = "p"; }],
    ["target principal", (_s, t) => { t.principalId = "p"; }],
  ];
  for (const [name, mutate] of mismatches) {
    test(`a ${name} mismatch fails with context before authorization`, async () => {
      const { source, target, transfer } = await pair();
      const sourceContext = { ...source.context }, targetContext = { ...target.context };
      mutate(sourceContext, targetContext);
      source.authorize.mockClear();
      assert.deepEqual(await target.service.copyToSite(transfer({ sourceContext, targetContext })), failed("context"));
      assert.equal(source.authorize.mock.calls.length, 0);
    });
  }

  test("copying into the same repository and workspace fails with context", async () => {
    const { source, transfer } = await pair();
    assert.deepEqual(await source.service.copyToSite(transfer({ targetContext: source.context })), failed("context"));
  });

  test("copying within one repository to another workspace succeeds", async () => {
    const { source, transfer } = await pair();
    const targetContext = { ...source.context, workspaceId: "elsewhere" };
    assert.deepEqual(await source.service.copyToSite(transfer({ targetContext })), [{ kind: "site-assistant", id: "a", status: "copied", last4: "mnop" }]);
  });

  test("an MCP env row asks for MCP configuration", async () => {
    const { target, transfer } = await pair({ kind: "mcp-env" });
    assert.deepEqual(await target.service.copyToSite(transfer()), [{ kind: "mcp-env", id: "a", status: "skipped", reasonCode: "requires-mcp-configuration" }]);
  });

  test("a personal row is not copyable", async () => {
    const { target, source, transfer } = await pair();
    const personal = { ...source.context, kind: "personal-execution" as const, principalId: "p" };
    assert.deepEqual(await target.service.copyToSite(transfer({ sourceContext: personal, targetContext: { ...target.context, kind: "personal-execution", principalId: "p" } })),
      [{ kind: "personal-execution", id: "a", status: "skipped", reasonCode: "kind-not-copyable" }]);
  });

  test("a missing source row fails as source-missing", async () => {
    const { target, transfer } = await pair();
    assert.deepEqual(await target.service.copyToSite(transfer({ ids: ["missing"] })), [{ kind: "site-assistant", id: "missing", status: "failed", reasonCode: "source-missing" }]);
  });

  test("a source row with substituted ownership fails with context", async () => {
    const { source, target, transfer } = await pair();
    const record = (await source.repo.find(source.context))!;
    vi.spyOn(source.repo, "find").mockResolvedValue({ ...record, ownerKey: "other" });
    assert.deepEqual(await target.service.copyToSite(transfer()), failed("context"));
  });

  test("a legacy-AAD source needs an upgrade", async () => {
    const { source, target, transfer } = await pair();
    const record = (await source.repo.find(source.context))!;
    await source.repo.put({ record: { ...record, meta: { legacyAad: true }, revision: 2 }, expectedRevision: 1 });
    assert.deepEqual(await target.service.copyToSite(transfer()), failed("source-needs-upgrade"));
  });

  for (const [name, meta] of [["subtype", { worksFor: [] }], ["works-for", { credentialType: "vendor" }]] satisfies [string, VaultRecord["meta"]][]) {
    test(`a vendor source without ${name} needs an upgrade`, async () => {
      const { source, target, transfer } = await pair({ kind: "vendor", meta: { credentialType: "vendor", worksFor: [] } });
      const record = (await source.repo.find(source.context))!;
      await source.repo.put({ record: { ...record, meta, revision: 2 }, expectedRevision: 1 });
      assert.deepEqual(await target.service.copyToSite(transfer()), failed("source-needs-upgrade", "vendor"));
    });
  }

  test("a stale selected source revision conflicts", async () => {
    const { target, transfer } = await pair();
    assert.deepEqual(await target.service.copyToSite(transfer({ sourceRevisions: { a: 2 } })), failed("conflict"));
  });

  test("a new copy that is not its group's first row is not default", async () => {
    const { target, transfer } = await pair();
    await target.service.put({ ...target.input, id: "other", label: "Other" });
    await target.service.copyToSite(transfer());
    assert.equal((await target.repo.find(target.context))?.isDefault, false);
  });

  test("a matching selected source revision copies", async () => {
    const { target, transfer } = await pair();
    assert.equal((await target.service.copyToSite(transfer({ sourceRevisions: { a: 1 } })))[0]?.status, "copied");
  });

  test("a selection without this ID uses the read revision", async () => {
    const { target, transfer } = await pair();
    assert.equal((await target.service.copyToSite(transfer({ sourceRevisions: { other: 9 } })))[0]?.status, "copied");
  });

  test("an existing target is skipped without overwrite", async () => {
    const { target, transfer } = await pair();
    await target.service.put(target.input);
    assert.deepEqual(await target.service.copyToSite(transfer()), [{ kind: "site-assistant", id: "a", status: "skipped", reasonCode: "target-exists" }]);
  });

  test("overwrite refuses a provider change", async () => {
    const { target, transfer } = await pair();
    await target.service.put({ ...target.input, provider: "other" });
    assert.deepEqual(await target.service.copyToSite(transfer({ overwrite: true })), failed("context"));
  });

  test("overwrite keeps the target's revision chain, default and createdAt", async () => {
    const { target, transfer } = await pair();
    target.now.mockReturnValueOnce("earlier");
    await target.service.put(target.input);
    await target.service.patchMeta({ ...target.context, expectedRevision: 1, patch: { model: "m" } });
    await target.service.copyToSite(transfer({ overwrite: true }));
    const after = (await target.repo.find(target.context))!;
    assert.deepEqual([after.revision, after.isDefault, after.createdAt, after.updatedAt, after.meta], [3, true, "earlier", NOW, {}]);
  });

  test("a non-vault failure is reported as copy-failed", async () => {
    const { target, transfer } = await pair();
    target.authorize.mockRejectedValue(new Error("denied"));
    assert.deepEqual(await target.service.copyToSite(transfer()), failed("copy-failed"));
  });

  test("a database destination copy carries no hints", async () => {
    const { target, transfer } = await pair({ kind: "database-destination" });
    await target.service.copyToSite(transfer());
    const after = (await target.repo.find(target.context))!;
    assert.deepEqual([after.last4, after.tokenLength], [null, null]);
  });

  test("other kinds carry the source's safe hints", async () => {
    const { target, transfer } = await pair();
    await target.service.copyToSite(transfer());
    const after = (await target.repo.find(target.context))!;
    assert.deepEqual([after.last4, after.tokenLength], ["mnop", 16]);
  });

  test("refuses an invalid target scope before any row", async () => {
    const { target, transfer } = await pair();
    await assert.rejects(target.service.copyToSite(transfer({ targetContext: { ...target.context, ownerKey: "" } })), contextError);
  });

  test("refuses an invalid source scope before any row", async () => {
    const { target, source, transfer } = await pair();
    await assert.rejects(target.service.copyToSite(transfer({ sourceContext: { ...source.context, workspaceId: "" } })), contextError);
  });
});
