import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, SettingsRevisionConflictError, ValueValidationFailedError } from "../errors.js";
import { SettingsRevisionConflictError as PublicConflictError } from "../index.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { clear, renameDefinition, set, type SettingsWriteServiceDeps } from "../write-service.js";
import type { SettingDefinitionRecord, SettingScope } from "../types.js";

function fixture(required: { scope: SettingScope }, _optional = {}) {
  const now = "2026-10-22T00:00:00.000Z";
  const definition: SettingDefinitionRecord = {
    settingId: "setting", version: 1, workspaceId: null, namespace: "core.cas", key: "choice",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "default",
    scopes: 7, secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null,
    coercionTag: null, createdAt: now, updatedAt: now,
  };
  const repo = new InMemorySettingsRepo({ definitions: [definition] });
  let id = 0;
  const deps: SettingsWriteServiceDeps = {
    repo, clock: { nowMs: () => Date.parse(now) }, ids: { newId: () => `id-${++id}` },
    authorize: async () => ({ allowed: true, reason: "test" }),
    principals: { findActiveById: async ({ id }) => ({ id }) },
  };
  const input = { namespace: definition.namespace, key: definition.key, scope: required.scope,
    workspaceId: "workspace", callerPrincipalId: "actor", value: "first" };
  const read = () => required.scope === "global" ? repo.getGlobalValue("setting")
    : required.scope === "workspace" ? repo.getWorkspaceValue({ workspaceId: "workspace", settingId: "setting" })
      : repo.getUserValue({ workspaceId: "workspace", principalId: "actor", settingId: "setting" });
  return { repo, deps, input, read };
}

for (const scope of ["global", "workspace", "user"] as const) {
  test(`${scope}: set/clear compare missing, set and cleared rows and roll back stale revisions`, async () => {
    const f = fixture({ scope });
    assert.equal(PublicConflictError, SettingsRevisionConflictError);
    const first = await set(f, { expectedRevisionSeq: 0 });
    const stored = await f.read();
    const revisions = await f.repo.listRevisions({ settingId: "setting" });
    for (const write of [() => set(f, { expectedRevisionSeq: 0 }), () => clear(f, { expectedRevisionSeq: 0 })]) {
      await assert.rejects(write, (error: unknown) => {
        assert.ok(error instanceof SettingsRevisionConflictError);
        assert.equal(error.name, "SettingsRevisionConflictError");
        assert.equal(error.expectedRevisionSeq, 0);
        assert.equal(error.actualRevisionSeq, first.revisionSeq);
        return true;
      });
      assert.deepEqual(await f.read(), stored);
      assert.deepEqual(await f.repo.listRevisions({ settingId: "setting" }), revisions);
      assert.equal(await f.repo.maxRevisionSeq(), first.revisionSeq);
    }
    const cleared = await clear(f, { expectedRevisionSeq: first.revisionSeq });
    assert.equal((await f.read())?.state, "cleared");
    assert.equal((await f.read())?.seq, cleared.revisionSeq);
    await assert.rejects(() => set(f, { expectedRevisionSeq: 0 }), SettingsRevisionConflictError);
    await assert.rejects(() => clear(f, { expectedRevisionSeq: first.revisionSeq }), SettingsRevisionConflictError);
    const next = await set(f, { expectedRevisionSeq: cleared.revisionSeq });
    assert.equal(next.revisionSeq, cleared.revisionSeq + 1);
    assert.equal((await f.read())?.valueJson, "first");
  });

  test(`${scope}: clear can compare an absent row against zero`, async () => {
    const f = fixture({ scope });
    await assert.rejects(() => clear(f, { expectedRevisionSeq: 1 }), SettingsRevisionConflictError);
    assert.equal(await f.read(), null);
    assert.equal(await f.repo.maxRevisionSeq(), 0);
    const result = await clear(f, { expectedRevisionSeq: 0 });
    assert.equal((await f.read())?.seq, result.revisionSeq);
    assert.equal((await f.read())?.state, "cleared");
  });

  test(`${scope}: matching options produce the same stored bytes as unconditional writes`, async () => {
    const guarded = fixture({ scope });
    const baseline = fixture({ scope });
    const treatment = await set(guarded, { expectedRevisionSeq: 0 });
    const control = await set(baseline);
    assert.deepEqual(treatment, control);
    assert.equal(JSON.stringify(await guarded.read()), JSON.stringify(await baseline.read()));
    assert.deepEqual(await clear(guarded, { expectedRevisionSeq: treatment.revisionSeq }), await clear(baseline));
    assert.equal(JSON.stringify(await guarded.read()), JSON.stringify(await baseline.read()));
    assert.equal(JSON.stringify(await guarded.repo.listRevisions({ settingId: "setting" })),
      JSON.stringify(await baseline.repo.listRevisions({ settingId: "setting" })));
  });

  test(`${scope}: omitted, empty and explicitly undefined options keep unconditional writes without value reads`, async () => {
    const f = fixture({ scope });
    // Any new value read would change the legacy I/O path, even if the final value looked right.
    f.repo.getGlobalValue = f.repo.getWorkspaceValue = f.repo.getUserValue = async () => {
      throw new Error("unconditional writes must not read a value");
    };
    await set(f);
    await set(f, {});
    await set(f, { expectedRevisionSeq: undefined });
    await clear(f);
    await clear(f, {});
    await clear(f, { expectedRevisionSeq: undefined });
    const revisions = await f.repo.listRevisions({ settingId: "setting" });
    assert.deepEqual(revisions.map(r => r.op), ["set", "set", "set", "clear", "clear", "clear"]);
    assert.deepEqual(revisions.map(r => r.seq), [1, 2, 3, 4, 5, 6]);
  });
}

test("CAS uses the addressed scope, workspace and principal, rather than inherited or ledger revisions", async () => {
  const f = fixture({ scope: "workspace" });
  await set({ ...f, input: { ...f.input, scope: "global" } });
  await set({ ...f, input: { ...f.input, workspaceId: "other-workspace" } });
  const workspace = await set(f, { expectedRevisionSeq: 0 });
  await set({ ...f, input: { ...f.input, scope: "user", principalId: "other-user" } }, { expectedRevisionSeq: 0 });
  const self = await set({ ...f, input: { ...f.input, scope: "user" } }, { expectedRevisionSeq: 0 });
  await clear({ ...f, input: { ...f.input, scope: "user", principalId: "actor" } }, { expectedRevisionSeq: self.revisionSeq });
  await set(f, { expectedRevisionSeq: workspace.revisionSeq });
});

test("same-value writes advance the revision and an alias compares the stable target identity", async () => {
  const f = fixture({ scope: "workspace" });
  const first = await set(f);
  const sameValue = await set(f, { expectedRevisionSeq: first.revisionSeq });
  await renameDefinition({ deps: f.deps, input: {
    namespace: f.input.namespace, key: f.input.key, workspaceId: null,
    newNamespace: f.input.namespace, newKey: "renamed", callerPrincipalId: "actor", authWorkspaceId: "workspace",
  } });
  await assert.rejects(() => set(f, { expectedRevisionSeq: first.revisionSeq }), SettingsRevisionConflictError);
  await clear(f, { expectedRevisionSeq: sameValue.revisionSeq });
  assert.equal((await f.read())?.state, "cleared");
});

test("authorization and validation still precede the revision comparison", async () => {
  const f = fixture({ scope: "workspace" });
  f.deps.authorize = async () => ({ allowed: false, reason: "denied" });
  await assert.rejects(() => set(f, { expectedRevisionSeq: 99 }), ForbiddenError);
  await assert.rejects(() => clear(f, { expectedRevisionSeq: 99 }), ForbiddenError);
  f.deps.authorize = async () => ({ allowed: true, reason: "test" });
  await assert.rejects(() => set({ ...f, input: { ...f.input, value: 12 } }, { expectedRevisionSeq: 99 }), ValueValidationFailedError);
  assert.equal(await f.repo.maxRevisionSeq(), 0);
});

test("a guarded clear inside an enclosing transaction rolls back earlier writes too", async () => {
  const f = fixture({ scope: "workspace" });
  const first = await set(f);
  const before = await f.read();
  await assert.rejects(() => f.repo.transaction(async () => {
    await clear({ ...f, input: { ...f.input, skipTransaction: true } }, { expectedRevisionSeq: first.revisionSeq });
    await clear({ ...f, input: { ...f.input, skipTransaction: true } }, { expectedRevisionSeq: first.revisionSeq });
  }), SettingsRevisionConflictError);
  assert.deepEqual(await f.read(), before);
  assert.equal(await f.repo.maxRevisionSeq(), first.revisionSeq);
});

test("a failed comparison read propagates its storage error and rolls back the appended revision", async () => {
  const f = fixture({ scope: "workspace" });
  const first = await set(f);
  const before = await f.read();
  const read = f.repo.getWorkspaceValue.bind(f.repo);
  const failure = new Error("value storage unavailable");
  f.repo.getWorkspaceValue = async () => { throw failure; };
  await assert.rejects(() => set(f, { expectedRevisionSeq: first.revisionSeq }), error => error === failure);
  f.repo.getWorkspaceValue = read;
  assert.deepEqual(await f.read(), before);
  assert.equal(await f.repo.maxRevisionSeq(), first.revisionSeq);
});

test("memory keeps its overlap refusal; a writer holding an old snapshot conflicts after the winner commits", async () => {
  const f = fixture({ scope: "workspace" });
  const first = await set(f);
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const append = f.repo.appendRevision.bind(f.repo);
  f.repo.appendRevision = async record => {
    const seq = await append(record);
    entered();
    await resume;
    return seq;
  };
  const winning = set(f, { expectedRevisionSeq: first.revisionSeq });
  try {
    await paused;
    await assert.rejects(() => set(f, { expectedRevisionSeq: first.revisionSeq }), /not reentrant/);
  } finally {
    release();
  }
  const winner = await winning;
  await assert.rejects(() => set(f, { expectedRevisionSeq: first.revisionSeq }), SettingsRevisionConflictError);
  assert.equal((await f.read())?.seq, winner.revisionSeq);
  assert.equal((await f.repo.listRevisions({ settingId: "setting" })).length, 2);
});
