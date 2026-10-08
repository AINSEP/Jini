import { expect, test, vi } from "vitest";
import { InMemorySettingsPrincipalLookup } from "../../__tests__/principal.fixture.js";
import { InMemorySettingsRepo, ForbiddenError, type SettingDefinitionRecord, type SettingRevisionRecord } from "../../index.js";
import { createCmsSettingsService, createCmsSettingsChangeFeed } from "../index.js";
import { permissions } from "./settings-fixture.js";

const NOW = "2026-09-01T00:00:00.000Z";
function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return { settingId: "color-setting", version: 1, workspaceId: null, namespace: "core.preferences", key: "color",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "paper", scopes: 7, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function setup(definitions: SettingDefinitionRecord[] = [definition()]) {
  const repo = new InMemorySettingsRepo({ definitions });
  const authorize = vi.fn(async () => ({ allowed: true, reason: "allowed" }));
  let id = 0;
  const deps = { repo, authorize, clock: { nowMs: () => Date.parse(NOW)}, ids: { newId: () => `new-${++id}` }, principals: new InMemorySettingsPrincipalLookup([]) };
  return { repo, authorize, service: createCmsSettingsService({ deps, permissions }), feed: createCmsSettingsChangeFeed({ repo }) };
}
// Generalized CMS/host write contracts: a value and its revision are committed together,
// while read and write layers retain the original behavior through the adapter.
test("CMS service maps host permissions and preserves value/revision writes and effective self reads", async () => {
  const f = setup();
  const result = await f.service.set({ namespace: "core.preferences", key: "color", scope: "user", workspaceId: "workspace-a",
    callerPrincipalId: "me", authWorkspaceId: "workspace-a", value: "blue" });
  expect(f.authorize).toHaveBeenCalledWith({ principalId: "me", workspaceId: "workspace-a", permission: "prefs.self", entityType: "setting-value" });
  expect(await f.repo.getUserValue({ workspaceId: "workspace-a", principalId: "me", settingId: "color-setting" })).toMatchObject({ valueJson: "blue", seq: result.revisionSeq });
  expect(await f.repo.listRevisions({ settingId: "color-setting" })).toMatchObject([{ op: "set", seq: result.revisionSeq }]);
  expect(await f.service.effective({ namespace: "core.preferences", workspaceId: "workspace-a", principalId: "me" }))
    .toEqual([{ key: "color", value: "blue", sourceLayer: "user", defVersion: 1 }]);
  expect(await f.service.raw({ namespace: "core.preferences", key: "color", workspaceId: "workspace-a", principalId: undefined }))
    .toEqual({ key: "core.preferences.color", global: null, workspace: null, user: null, default: "paper" });
  const cleared = await f.service.clear({ namespace: "core.preferences", key: "color", scope: "user", workspaceId: "workspace-a", callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
  expect(cleared.revisionSeq).toBeGreaterThan(result.revisionSeq);
  expect(await f.service.raw({ namespace: "core.preferences", key: "color", workspaceId: "workspace-a", principalId: "me" }))
    .toEqual({ key: "core.preferences.color", global: null, workspace: null, user: null, default: "paper" });
});
test("CMS remains the write authorization gate when an HTTP precheck is bypassed", async () => {
  const f = setup(); f.authorize.mockResolvedValue({ allowed: false, reason: "no_grant" });
  await expect(f.service.set({ namespace: "core.preferences", key: "color", scope: "workspace", workspaceId: "workspace-a",
    callerPrincipalId: "me", authWorkspaceId: "workspace-a", value: "blue" })).rejects.toBeInstanceOf(ForbiddenError);
  expect(await f.repo.listRevisions({ settingId: "color-setting" })).toEqual([]);
});
test("global reset maps the coarse reset grant and returns paired revision ids", async () => {
  const f = setup();
  await f.service.set({ namespace: "core.preferences", key: "color", scope: "global", callerPrincipalId: "me", authWorkspaceId: "workspace-a", value: "blue" });
  f.authorize.mockClear();
  const result = await f.service.reset({ namespace: "core.preferences", scope: "global", callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
  expect(result.clearedCount).toBe(1); expect(result.revisionSeqs.length).toBe(1);
  expect(f.authorize.mock.calls).toEqual([[{ principalId: "me", permission: "reset.all", workspaceId: "workspace-a", entityType: "setting-namespace" }]]);
  expect((await f.repo.listRevisions({ settingId: "color-setting" })).map((r) => r.op)).toEqual(["set", "clear"]);
});
test("definition registration uses CMS contracts and maps the host manage permission", async () => {
  const f = setup([]);
  const result = await f.service.definitions({ callerPrincipalId: "me", authWorkspaceId: "workspace-a", items: [
    { namespace: "core.preferences", key: "color", ownerKind: "core", schemaJson: { type: "string" }, defaultJson: "paper", scopes: 7 },
  ] });
  expect(result).toEqual({ applied: [{ key: "core.preferences.color", op: "register", status: "applied" }] });
  expect(f.authorize).toHaveBeenCalledWith({ principalId: "me", permission: "prefs.manage", workspaceId: "workspace-a", entityType: "setting-definition" });
  expect((await f.service.listDefinitions({ workspaceId: "workspace-a" })).map((d) => d.key)).toEqual(["color"]);
});
test.each(["constructor", "__proto__", "toString"])("unknown operation %s is rejected without invoking CMS", async (op) => {
  const f = setup();
  expect(await f.service.definitions({ callerPrincipalId: "me", authWorkspaceId: "workspace-a", items: [{ op }] })).toEqual({ unknownOp: op });
  expect(f.authorize).not.toHaveBeenCalled();
});
function revision(overrides: Partial<Omit<SettingRevisionRecord, "seq">> = {}): Omit<SettingRevisionRecord, "seq"> {
  return { entityKind: "value", settingId: "color-setting", scope: "workspace", workspaceId: "workspace-a", principalId: null,
    op: "set", beforeJson: null, afterJson: "private value", defVersion: 1, actor: "me", originPluginId: null, changeSetId: null, createdAt: NOW, ...overrides };
}
test("CMS change feed hides other tenants/users while advancing examined cursors and emitting no values", async () => {
  const f = setup();
  await f.repo.appendRevision(revision({ workspaceId: "workspace-b" }));
  const visibleSeq = await f.repo.appendRevision(revision());
  const privateSeq = await f.repo.appendRevision(revision({ scope: "user", principalId: "them" }));
  const batch = await f.feed.collect({ sinceSeq: 0, limit: 200, viewer: { workspaceId: "workspace-a", principalId: "me" } });
  expect(batch).toEqual({ cursor: privateSeq, namespaces: ["core.preferences"], examinedCount: 2 });
  expect(await f.feed.head({})).toBe(privateSeq); expect(visibleSeq).toBeLessThan(privateSeq);
  expect(JSON.stringify(batch)).not.toContain("private value");
});
test("unresolvable definitions advance the cursor without inventing a namespace", async () => {
  const f = setup(); const seq = await f.repo.appendRevision(revision({ settingId: "missing" }));
  expect(await f.feed.collect({ sinceSeq: 0, limit: 200, viewer: { workspaceId: "workspace-a", principalId: "me" } }))
    .toEqual({ cursor: seq, namespaces: [], examinedCount: 1 });
});

test("definition batches preserve earlier non-register writes when a later op is unknown", async () => {
  const f = setup();
  const result = await f.service.definitions({ callerPrincipalId: "me", authWorkspaceId: "workspace-a", items: [
    { namespace: "core.preferences", key: "color", ownerKind: "core", op: "deprecate" },
    { namespace: "core.preferences", key: "color", ownerKind: "core", op: "constructor" },
  ] });
  expect(result).toEqual({ unknownOp: "constructor" });
  expect((await f.repo.findDefinitionBySettingId({ settingId: "color-setting" }))?.status).toBe("deprecated");
  expect((await f.repo.listRevisions({ settingId: "color-setting" })).map((r) => r.op)).toEqual(["deprecate"]);
});
