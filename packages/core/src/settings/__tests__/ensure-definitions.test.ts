import assert from "node:assert/strict";
import { test } from "vitest";
import { ensureSettingDefinitions, type SettingDefinitionSpec } from "../ensure-definitions.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { getEffective } from "../settings.js";
import { SCOPE_BIT } from "../types.js";
import { set } from "../write-service.js";
import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";

/** Real ledger seam: boot must preserve site-owned rows and core reconciliation,
 * with sequential writes so one connection never overlaps registration transactions. */
function fixture() {
  let nextId = 0;
  return {
    settingsRepo: new InMemorySettingsRepo(),
    clock: { nowMs: () => Date.parse("2026-10-07T00:00:00Z") },
    ids: { newId: () => `definition-${++nextId}` },
    principals: new InMemorySettingsPrincipalLookup([]),
  };
}

const definitions: readonly SettingDefinitionSpec[] = [
  { key: "enabled", schema: { type: "boolean" }, defaultValue: false },
  { key: "limit", schema: { type: "number" }, defaultValue: 20, scopes: SCOPE_BIT.workspace | SCOPE_BIT.user },
];

test("site bootstrap preserves every definition field and ordered register revisions", async () => {
  const deps = fixture();
  await ensureSettingDefinitions(deps, {
    namespace: "site.assistant", definitions, systemPrincipalId: "boot", ownerKind: "site", workspaceId: "workspace-1",
  });
  const rows = await deps.settingsRepo.listActiveDefinitions({ workspaceId: "workspace-1" });
  assert.deepEqual(rows.map(({ namespace, key, ownerKind, workspaceId, schema, defaultValue, scopes, secret }) =>
    ({ namespace, key, ownerKind, workspaceId, schema, defaultValue, scopes, secret })), [
    { namespace: "site.assistant", key: "enabled", ownerKind: "site", workspaceId: "workspace-1", schema: { type: "boolean" }, defaultValue: false, scopes: 2, secret: false },
    { namespace: "site.assistant", key: "limit", ownerKind: "site", workspaceId: "workspace-1", schema: { type: "number" }, defaultValue: 20, scopes: 6, secret: false },
  ]);
  assert.deepEqual(await deps.settingsRepo.listActiveDefinitions({ workspaceId: null }), []);
  const revisions = await deps.settingsRepo.listRevisionsSince({ sinceSeq: 0, limit: 10, workspaceId: "workspace-1" });
  assert.deepEqual(revisions.map(({ seq, op, actor, workspaceId }) => ({ seq, op, actor, workspaceId })), [
    { seq: 1, op: "register", actor: "boot", workspaceId: "workspace-1" },
    { seq: 2, op: "register", actor: "boot", workspaceId: "workspace-1" },
  ]);
});

test("site bootstrap never rewrites an existing default and registers separately per workspace", async () => {
  const deps = fixture();
  const input = { namespace: "site.assistant", definitions, systemPrincipalId: "boot", ownerKind: "site" as const, workspaceId: "workspace-1" };
  await ensureSettingDefinitions(deps, input);
  const before = await deps.settingsRepo.listActiveDefinitions({ workspaceId: "workspace-1" });
  const changed = [{ ...definitions[0]!, defaultValue: true }, definitions[1]!];
  await ensureSettingDefinitions(deps, { ...input, definitions: changed });
  assert.deepEqual(await deps.settingsRepo.listActiveDefinitions({ workspaceId: "workspace-1" }), before);
  assert.equal(await deps.settingsRepo.maxRevisionSeq(), 2);
  await ensureSettingDefinitions(deps, { ...input, definitions: changed, workspaceId: "workspace-2" });
  for (const [workspaceId, expected] of [["workspace-1", false], ["workspace-2", true]] as const) {
    const result = await getEffective({ repo: deps.settingsRepo }, { namespace: input.namespace, key: "enabled", scopeContext: { workspaceId } });
    assert.equal(result?.value, expected);
  }
});

test("the existing core default reconciliation remains platform-wide and idempotent", async () => {
  const deps = fixture();
  const input = { namespace: "core.analytics", definitions, systemPrincipalId: "boot" };
  await ensureSettingDefinitions(deps, input);
  const changed = { ...input, definitions: [{ ...definitions[0]!, defaultValue: true }, definitions[1]!] };
  await ensureSettingDefinitions(deps, changed);
  await ensureSettingDefinitions(deps, changed);
  const row = await deps.settingsRepo.findActiveDefinition({ namespace: input.namespace, key: "enabled", workspaceId: null });
  assert.ok(row);
  assert.equal(row.ownerKind, "core");
  assert.equal(row.defaultValue, true);
  assert.equal(row.version, 1);
  assert.deepEqual((await deps.settingsRepo.listRevisions({ settingId: row.settingId })).map(({ op }) => op), ["register", "redefault"]);
  assert.equal(await deps.settingsRepo.maxRevisionSeq(), 3);
});

test("boot leaves existing workspace values effective even when source defaults change", async () => {
  const deps = fixture();
  const input = { namespace: "site.comments", definitions, systemPrincipalId: "boot", ownerKind: "site" as const, workspaceId: "workspace-1" };
  await ensureSettingDefinitions(deps, input);
  await set({
    deps: { repo: deps.settingsRepo, clock: deps.clock, ids: deps.ids, principals: deps.principals, authorize: async () => ({ allowed: true, reason: "matched" }) },
    input: { namespace: input.namespace, key: "enabled", scope: "workspace", value: true, workspaceId: input.workspaceId,
      authWorkspaceId: input.workspaceId, callerPrincipalId: "operator", requiredPermissionOverride: "comments.configure" },
  });
  const before = await deps.settingsRepo.listWorkspaceValues({ workspaceId: input.workspaceId });
  await ensureSettingDefinitions(deps, { ...input, definitions: [{ ...definitions[0]!, defaultValue: true }, definitions[1]!] });
  assert.deepEqual(await deps.settingsRepo.listWorkspaceValues({ workspaceId: input.workspaceId }), before);
  assert.deepEqual(await getEffective({ repo: deps.settingsRepo }, {
    namespace: input.namespace, key: "enabled", scopeContext: { workspaceId: input.workspaceId },
  }), { value: true, sourceLayer: "workspace", defVersion: 1 });
  assert.equal(await deps.settingsRepo.maxRevisionSeq(), 3);
});

test("a registration failure rejects readiness before any later definition is written", async () => {
  const deps = fixture();
  const failure = new Error("registration failed");
  class RefusingRepo extends InMemorySettingsRepo {
    override async saveDefinition(record: Parameters<InMemorySettingsRepo["saveDefinition"]>[0]): Promise<void> {
      if (record.key === "enabled") throw failure;
      await super.saveDefinition(record);
    }
  }
  const settingsRepo = new RefusingRepo();
  await assert.rejects(() => ensureSettingDefinitions({ ...deps, settingsRepo }, {
    namespace: "site.assistant", definitions, systemPrincipalId: "boot", ownerKind: "site", workspaceId: "workspace-1",
  }), (error: unknown) => error === failure);
  assert.deepEqual(await settingsRepo.listActiveDefinitions({ workspaceId: "workspace-1" }), []);
  assert.equal(await settingsRepo.maxRevisionSeq(), 0);
});
