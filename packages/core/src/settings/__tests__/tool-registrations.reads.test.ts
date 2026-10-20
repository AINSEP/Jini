import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ForbiddenError } from "../../tool-permissions.js";
import type { SettingValueRecord } from "../types.js";
import { definition, fixture, target } from "./write-tool-fixture.js";

/** Pins for the settings read tools (`settings_get_effective`, `settings_get_raw`). */

function value(overrides: Partial<SettingValueRecord>): SettingValueRecord {
  return {
    settingId: "setting-1", scope: "global", workspaceId: null, principalId: null, valueJson: "x", state: "set",
    defVersion: 1, seq: 1, updatedBy: "actor-1", updatedAt: "2026-10-01T00:00:00.000Z", originPluginId: null, ...overrides,
  };
}

const denyCrossPrincipal = async (input: { permission: string }) => (input.permission === "settings.user.read" ? { allowed: false, reason: "no_grant" as const } : { allowed: true, reason: "matched" as const });

async function seed(f: ReturnType<typeof fixture>) {
  await f.settingsRepo.saveGlobalValue(value({ valueJson: "global" }));
  await f.settingsRepo.saveWorkspaceValue(value({ scope: "workspace", workspaceId: "ws-1", valueJson: "workspace" }));
  await f.settingsRepo.saveUserValue(value({ scope: "user", workspaceId: "ws-1", principalId: "caller", valueJson: "mine" }));
  await f.settingsRepo.saveUserValue(value({ scope: "user", workspaceId: "ws-1", principalId: "other", valueJson: "theirs" }));
}

test("get_effective defaults to the caller's own user layer and lists only the namespace's keys", async () => {
  const f = fixture([definition(), definition({ settingId: "s2", key: "locale", defaultValue: "en" }), definition({ settingId: "s3", namespace: "core.other", key: "x" })]);
  await seed(f);
  assert.deepEqual(await f.call("settings_get_effective", { namespace: "core.presentation" }), { data: [
    { key: "timezone", value: "mine", sourceLayer: "user", defVersion: 1 },
    { key: "locale", value: "en", sourceLayer: "default", defVersion: 1 },
  ] });
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.read"]);
});

test("get_effective naming the caller explicitly needs no cross-principal permission", async () => {
  const f = fixture(undefined, { authorize: denyCrossPrincipal });
  await seed(f);
  assert.deepEqual(await f.call("settings_get_effective", { namespace: "core.presentation", principalId: "caller" }), { data: [{ key: "timezone", value: "mine", sourceLayer: "user", defVersion: 1 }] });
});

test("get_effective for another principal requires settings.user.read and then reads their layer", async () => {
  const f = fixture();
  await seed(f);
  assert.deepEqual(await f.call("settings_get_effective", { namespace: "core.presentation", principalId: "other" }), { data: [{ key: "timezone", value: "theirs", sourceLayer: "user", defVersion: 1 }] });
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.read", "settings.user.read"]);
});

test("get_effective for another principal is refused without settings.user.read", async () => {
  const f = fixture(undefined, { authorize: denyCrossPrincipal });
  const read = vi.spyOn(f.settingsRepo, "getUserValue");
  await assert.rejects(() => f.call("settings_get_effective", { namespace: "core.presentation", principalId: "other" }), { constructor: ForbiddenError, message: "principal 'caller' is not authorized for 'settings.user.read' (no_grant)" });
  assert.equal(read.mock.calls.length, 0);
});

test("get_effective omits a listed key whose alias target resolves to nothing", async () => {
  const f = fixture([definition({ status: "alias", aliasOfNamespace: "core.gone", aliasOfKey: "g" })]);
  assert.deepEqual(await f.call("settings_get_effective", { namespace: "core.presentation" }), { data: [] });
});

test("get_effective refuses a missing namespace", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_get_effective", {}), { name: "ToolInputError", message: /^'namespace' \(non-empty string\) is required/ });
});

test("get_raw reports every layer for the caller, with cleared layers as null", async () => {
  const f = fixture();
  await seed(f);
  await f.settingsRepo.saveWorkspaceValue(value({ scope: "workspace", workspaceId: "ws-1", valueJson: "workspace", state: "cleared" }));
  assert.deepEqual(await f.call("settings_get_raw", target), { key: "core.presentation.timezone", global: "global", workspace: null, user: "mine", default: "UTC" });
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.read.raw"]);
});

test("get_raw for another principal reads their layer after the cross-principal check", async () => {
  const f = fixture();
  await seed(f);
  assert.equal((await f.call("settings_get_raw", { ...target, principalId: "other" }) as { user: unknown }).user, "theirs");
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.read.raw", "settings.user.read"]);
});

test("get_raw with an empty principalId reads no user layer (after the cross-principal check)", async () => {
  const f = fixture();
  await seed(f);
  const read = vi.spyOn(f.settingsRepo, "getUserValue");
  assert.equal((await f.call("settings_get_raw", { ...target, principalId: "" }) as { user: unknown }).user, null);
  assert.equal(read.mock.calls.length, 0);
  assert.deepEqual(f.authorizeCalls.map((call) => (call as { permission: string }).permission), ["settings.read.raw", "settings.user.read"]);
});

test("get_raw refuses another principal without settings.user.read", async () => {
  const f = fixture(undefined, { authorize: denyCrossPrincipal });
  await assert.rejects(() => f.call("settings_get_raw", { ...target, principalId: "other" }), { constructor: ForbiddenError, message: "principal 'caller' is not authorized for 'settings.user.read' (no_grant)" });
});

test("get_raw on an unknown definition fails with a plain not-found error", async () => {
  const f = fixture([]);
  await assert.rejects(() => f.call("settings_get_raw", target), { name: "Error", message: "definition 'core.presentation.timezone' was not found" });
});

test("get_raw refuses a non-string principalId", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_get_raw", { ...target, principalId: 5 }), { name: "ToolInputError", message: "'principalId' must be a string" });
});
