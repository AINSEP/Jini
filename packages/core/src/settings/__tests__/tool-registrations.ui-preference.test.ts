import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ForbiddenError } from "../errors.js";
import { definition, fixture } from "./write-tool-fixture.js";

/** Pins for `settings_set_ui_preference`: allowlist, value presence, readiness and error decoration. */

const theme = definition({ settingId: "theme", namespace: "core.appearance", key: "theme", schema: { type: "enum", values: ["system", "light", "dark"] }, defaultValue: "system" });
const sound = definition({ settingId: "sound", namespace: "core.notifications", key: "soundEnabled", schema: { type: "boolean" }, defaultValue: true });
const never = () => new Promise<void>(() => {});

test("writes the caller's own user layer and reports the stored value", async () => {
  const f = fixture([theme]);
  assert.deepEqual(await f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "dark" }), { setting: "core.appearance.theme", value: "dark", scope: "user", revisionSeq: 1 });
  assert.equal((await f.settingsRepo.getUserValue({ workspaceId: "ws-1", principalId: "caller", settingId: "theme" }))?.valueJson, "dark");
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.user.self.write"]);
});

test("false is a legitimate value", async () => {
  const f = fixture([sound]);
  assert.equal((await f.call("settings_set_ui_preference", { setting: "core.notifications.soundEnabled", value: false }) as { value: unknown }).value, false);
});

test("an unlisted id is refused before UI-tab readiness is awaited", async () => {
  const f = fixture([theme], { settingsUiTabsReady: never() });
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.presentation.timezone", value: "x" }), { name: "Error", message: /^'core\.presentation\.timezone' is not an agent-writable preference\. Allowed: core\.language\.locale, / });
});

test("a missing value is refused", async () => {
  const f = fixture([theme]);
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme" }), { name: "Error", message: "a 'value' is required to set 'core.appearance.theme'" });
});

test("waits on UI-tab readiness, not legacy settings readiness", async () => {
  const f = fixture([theme], { settingsReady: never() });
  assert.equal((await f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "light" }) as { value: unknown }).value, "light");
});

test("a value of the wrong shape is decorated with the tool schema", async () => {
  const f = fixture([theme]);
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "neon" }), { name: "ToolInputError", message: /^value for 'core\.appearance\.theme' does not match.*Schema for 'settings_set_ui_preference': / });
});

test("an unregistered definition is decorated with the tool schema", async () => {
  const f = fixture([]);
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "dark" }), { name: "ToolInputError", message: /not found.*Schema for 'settings_set_ui_preference': / });
});

test("a tombstoned definition is decorated with the tool schema", async () => {
  const f = fixture([{ ...theme, status: "tombstone" }]);
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "dark" }), { name: "ToolInputError", message: /tombstoned.*Schema for 'settings_set_ui_preference': / });
});

test("a definition without the user scope is decorated with the tool schema", async () => {
  const f = fixture([{ ...theme, scopes: 2 }]);
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "dark" }), { name: "ToolInputError", message: /Schema for 'settings_set_ui_preference': / });
});

test("a missing grant is not decorated (no input change fixes it)", async () => {
  const f = fixture([theme], { authorize: async () => ({ allowed: false, reason: "no_grant" }) });
  const write = vi.spyOn(f.settingsRepo, "saveUserValue");
  await assert.rejects(() => f.call("settings_set_ui_preference", { setting: "core.appearance.theme", value: "dark" }), { constructor: ForbiddenError, message: "principal 'caller' is not authorized for 'settings.user.self.write' (no_grant)" });
  assert.equal(write.mock.calls.length, 0);
});
