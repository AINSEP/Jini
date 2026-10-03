import assert from "node:assert/strict";
import { test } from "vitest";
import { definition, fixture, target } from "./write-tool-fixture.js";

test("clear removes one override, preserves workspace and reports caller-effective fallback", async () => {
  const f = fixture();
  await f.call("settings_set_value", { ...target, value: "Pacific" });
  await f.call("settings_set_value", { ...target, scope: "user", value: "Europe" });
  assert.deepEqual(await f.call("settings_clear_value", { ...target, scope: "user" }), { key: "core.presentation.timezone", scope: "user", previous: "Europe", effective: "Pacific" });
  assert.equal((await f.settingsRepo.getUserValue({ workspaceId: "ws-1", principalId: "caller", settingId: "setting-1" }))?.state, "cleared");
  assert.equal((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: "setting-1" }))?.valueJson, "Pacific");
  assert.deepEqual(await f.call("settings_clear_value", target), { key: "core.presentation.timezone", scope: "workspace", previous: "Pacific", effective: "UTC" });
  assert.equal(f.registrations.find((r) => r.descriptor.id === "settings_clear_value")!.descriptor.readOnly, false);
});

test("clear on protected instructions also needs confirmation before any mutation", async () => {
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })]);
  await assert.rejects(() => f.call("settings_clear_value", { namespace: "core.instructions", key: "custom" }), { name: "ToolInputError", message: "settings_clear_value: 'core.instructions.custom' requires a human confirmation card: The assistant's own standing instructions are self-modification. The owner can change it in Settings." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("clear refuses denied host rules and permissions and unknown definitions", async () => {
  const denied = fixture(undefined, { extraDeniedSettings: [{ ...target, reason: "Host restriction" }] } as any);
  await assert.rejects(() => denied.call("settings_clear_value", target), { name: "ToolInputError", message: "settings_clear_value: 'core.presentation.timezone' can't be changed by the assistant: Host restriction. The owner can change it in Settings." });
  const permission = fixture(undefined, { authorize: async () => ({ allowed: false, reason: "no_grant" }) });
  await assert.rejects(() => permission.call("settings_clear_value", target), { name: "ToolInputError", message: "settings_clear_value: permission 'settings.workspace.write' is required. Ask the owner to grant it before retrying." });
  const unknown = fixture([]);
  await assert.rejects(() => unknown.call("settings_clear_value", target), { name: "ToolInputError", message: "settings_clear_value: setting 'core.presentation.timezone' was not found. Call settings_list_definitions to see valid keys." });
});

for (const [name, defs, input, message] of [
  ["tombstone", [definition({ status: "tombstone" })], target, "settings_clear_value: setting 'core.presentation.timezone' has been tombstoned. Call settings_list_definitions to see valid keys."],
  ["disallowed user scope", [definition({ scopes: 2 })], { ...target, scope: "user" }, "settings_clear_value: 'core.presentation.timezone' can't be set per-user. Call settings_list_definitions to see allowed scopes."],
  ["global scope", [definition()], { ...target, scope: "global" }, "settings_clear_value: scope must be 'workspace' or 'user'; global settings are not writable by this tool."],
  ["foreign principal", [definition()], { ...target, principalId: "other" }, "settings_clear_value: unexpected input 'principalId'. Only namespace, key, scope are accepted; the caller's own user layer is the only user target."],
] as const) {
  test(`clear refuses ${name} without recording a revision`, async () => {
    const f = fixture([...defs]);
    await assert.rejects(() => f.call("settings_clear_value", input), { name: "ToolInputError", message });
    assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
  });
}

test("clear honors a denied alias target before changing either layer", async () => {
  const f = fixture([
    definition({ settingId: "alias", status: "alias", aliasOfNamespace: "core.host", aliasOfKey: "locked" }),
    definition({ namespace: "core.host", key: "locked" }),
  ], { extraDeniedSettings: [{ namespace: "core.host", reason: "Host restriction" }] });
  await assert.rejects(() => f.call("settings_clear_value", target), { name: "ToolInputError", message: "settings_clear_value: 'core.host.locked' can't be changed by the assistant: Host restriction. The owner can change it in Settings." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});
