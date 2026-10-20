import { expect, test, vi } from "vitest";
import { InMemorySettingsPrincipalLookup } from "../../__tests__/principal.fixture.js";
import { InMemorySettingsRepo, ForbiddenError, type AuthorizeFn, type SettingDefinitionRecord } from "../../index.js";
import { createCmsSettingsService } from "../index.js";
import { permissions } from "./settings-fixture.js";

// Pins every branch of the CMS adapter that the shared contract suite (settings-cms.test.ts) does not reach.
const NOW = "2026-09-01T00:00:00.000Z";
function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return { settingId: "color-setting", version: 1, workspaceId: null, namespace: "core.preferences", key: "color",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "paper", scopes: 7, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function setup(definitions: SettingDefinitionRecord[] = [definition()]) {
  const repo = new InMemorySettingsRepo({ definitions });
  const authorize = vi.fn<AuthorizeFn>(async () => ({ allowed: true, reason: "allowed" }));
  let id = 0;
  const deps = { repo, authorize, clock: { nowMs: () => Date.parse(NOW) }, ids: { newId: () => `new-${++id}` }, principals: new InMemorySettingsPrincipalLookup([]) };
  return { repo, authorize, service: createCmsSettingsService({ deps, permissions }) };
}
const ctx = { callerPrincipalId: "me", authWorkspaceId: "workspace-a" };

test("a CMS permission with no host mapping is refused without consulting the host authorizer", async () => {
  const f = setup();
  const write = f.service.set({ namespace: "core.preferences", key: "color", scope: "workspace", workspaceId: "workspace-a",
    ...ctx, value: "blue", requiredPermissionOverride: "comments.configure" });
  await expect(write).rejects.toBeInstanceOf(ForbiddenError);
  await expect(write).rejects.toThrow("principal 'me' is not authorized for 'comments.configure' (unknown_settings_permission)");
  expect(f.authorize).not.toHaveBeenCalled();
  expect(await f.repo.listRevisions({ settingId: "color-setting" })).toEqual([]);
});

test.each([
  ["settings.global.write", "global", "prefs.global"],
  ["settings.workspace.write", "workspace", "prefs.workspace"],
] as const)("CMS permission %s is translated to the host grant for a %s write", async (_cms, scope, hostPermission) => {
  const f = setup();
  await f.service.set({ namespace: "core.preferences", key: "color", scope, workspaceId: "workspace-a", ...ctx, value: "blue" });
  expect(f.authorize.mock.calls.map(([input]) => input.permission)).toEqual([hostPermission]);
});

test("CMS permission settings.user.write is translated to the host's other-user grant before the target is resolved", async () => {
  const f = setup();
  await expect(f.service.set({ namespace: "core.preferences", key: "color", scope: "user", workspaceId: "workspace-a", ...ctx,
    value: "blue", principalId: "them" })).rejects.toThrow("principal 'them' was not found in workspace 'workspace-a'");
  expect(f.authorize.mock.calls.map(([input]) => input.permission)).toEqual(["prefs.other"]);
});

test("raw returns null for an unknown definition without reading any value layer", async () => {
  const f = setup();
  const reads = vi.spyOn(f.repo, "getGlobalValue");
  expect(await f.service.raw({ namespace: "core.preferences", key: "missing", workspaceId: "workspace-a", principalId: "me" })).toBeNull();
  expect(reads).not.toHaveBeenCalled();
});

test("raw reports every set layer side by side with the default", async () => {
  const f = setup();
  for (const [scope, value] of [["global", "g"], ["workspace", "w"], ["user", "u"]] as const) {
    await f.service.set({ namespace: "core.preferences", key: "color", scope, workspaceId: "workspace-a", ...ctx, value });
  }
  expect(await f.service.raw({ namespace: "core.preferences", key: "color", workspaceId: "workspace-a", principalId: "me" }))
    .toEqual({ key: "core.preferences.color", global: "g", workspace: "w", user: "u", default: "paper" });
});

test("effective lists only the requested namespace's keys", async () => {
  const f = setup([definition(), definition({ settingId: "other", namespace: "core.other", key: "size" })]);
  expect(await f.service.effective({ namespace: "core.other", workspaceId: "workspace-a", principalId: undefined }))
    .toEqual([{ key: "size", value: "paper", sourceLayer: "default", defVersion: 1 }]);
});

test("a workspace reset of a core namespace clears nothing because core keys live in the platform partition (reported, not fixed)", async () => {
  const f = setup();
  await f.service.set({ namespace: "core.preferences", key: "color", scope: "workspace", workspaceId: "workspace-a", ...ctx, value: "blue" });
  const result = await f.service.reset({ namespace: "core.preferences", scope: "workspace", workspaceId: "workspace-a", ...ctx });
  expect(result).toEqual({ clearedCount: 0, revisionSeqs: [] });
  expect((await f.repo.getWorkspaceValue({ workspaceId: "workspace-a", settingId: "color-setting" }))?.valueJson).toBe("blue");
});

test("a workspace reset without a body workspace lists keys from the auth workspace", async () => {
  const f = setup([definition({ settingId: "site-color", namespace: "site.preferences", ownerKind: "site", workspaceId: "workspace-a" })]);
  await f.service.set({ namespace: "site.preferences", key: "color", scope: "workspace", workspaceId: "workspace-a", ...ctx, value: "blue" });
  const listed = vi.spyOn(f.repo, "listActiveDefinitions");
  // The key list comes from the auth workspace, but CMS itself resolves each key without a target workspace.
  await expect(f.service.reset({ namespace: "site.preferences", scope: "workspace", ...ctx }))
    .rejects.toThrow("setting 'site.preferences.color' was not found");
  expect(listed).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
});

test("a workspace reset with neither a body nor an auth workspace lists platform keys", async () => {
  const f = setup();
  const listed = vi.spyOn(f.repo, "listActiveDefinitions");
  expect(await f.service.reset({ namespace: "core.preferences", scope: "workspace", callerPrincipalId: "me" }))
    .toEqual({ clearedCount: 1, revisionSeqs: [1] });
  expect(listed).toHaveBeenCalledWith({ workspaceId: null });
});

test("a site registration is placed in the caller's auth workspace with every field coerced", async () => {
  const f = setup([]);
  const result = await f.service.definitions({ ...ctx, items: [
    { op: "register", namespace: "site.preferences", key: "limit", ownerKind: "site", schemaJson: { type: "number" }, defaultJson: 3, scopes: "2", secret: 0 },
  ] });
  expect(result).toEqual({ applied: [{ key: "site.preferences.limit", op: "register", status: "applied" }] });
  const [row] = await f.repo.listActiveDefinitions({ workspaceId: "workspace-a" });
  expect(row).toMatchObject({ namespace: "site.preferences", key: "limit", ownerKind: "site", workspaceId: "workspace-a", defaultValue: 3, scopes: 2, secret: false });
});

test("register batches every item into one write after the loop", async () => {
  const f = setup([]);
  await f.service.definitions({ ...ctx, items: [
    { namespace: "core.a", key: "one", ownerKind: "core", schemaJson: { type: "string" }, defaultJson: "x", scopes: 2 },
    { namespace: "core.a", key: "two", ownerKind: "core", schemaJson: { type: "string" }, defaultJson: "y", scopes: 2 },
  ] });
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect((await f.repo.listActiveDefinitions({ workspaceId: null })).map((d) => d.key)).toEqual(["one", "two"]);
});

test("an item missing namespace and key registers the empty strings and fails CMS validation", async () => {
  const f = setup([]);
  await expect(f.service.definitions({ ...ctx, items: [{ ownerKind: "core", schemaJson: { type: "string" }, defaultJson: "x", scopes: 2 }] }))
    .rejects.toThrow(/namespace/i);
});

test("rename forwards newNamespace and newKey to CMS", async () => {
  const f = setup();
  const result = await f.service.definitions({ ...ctx, items: [
    { op: "rename", namespace: "core.preferences", key: "color", ownerKind: "core", newNamespace: "core.theme", newKey: "tint" },
  ] });
  expect(result).toEqual({ applied: [{ key: "core.preferences.color", op: "rename", status: "applied" }] });
  expect(await f.repo.findActiveDefinition({ namespace: "core.theme", key: "tint", workspaceId: null })).toMatchObject({ settingId: "color-setting" });
});

test("retype forwards schemaJson, defaultJson and coercionJson to CMS", async () => {
  const f = setup();
  await f.service.definitions({ ...ctx, items: [
    { op: "retype", namespace: "core.preferences", key: "color", ownerKind: "core", schemaJson: { type: "number" }, defaultJson: 4, coercionJson: { tag: "identity" } },
  ] });
  expect(await f.repo.findActiveDefinition({ namespace: "core.preferences", key: "color", workspaceId: null }))
    .toMatchObject({ schema: { type: "number" }, defaultValue: 4, coercionTag: "identity" });
});

test("a site op item targets the auth workspace while a core op item targets the platform", async () => {
  const f = setup([definition({ settingId: "site-color", namespace: "site.preferences", ownerKind: "site", workspaceId: "workspace-a" })]);
  await f.service.definitions({ ...ctx, items: [{ op: "tombstone", namespace: "site.preferences", key: "color", ownerKind: "site" }] });
  expect((await f.repo.findActiveDefinition({ namespace: "site.preferences", key: "color", workspaceId: "workspace-a" }))?.status).toBe("tombstone");
});
