import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingsWriteConfirmation } from "../agent-value-write-tools.js";
import type { SettingValueRecord } from "../types.js";
import { definition, fixture, target } from "./write-tool-fixture.js";

/** Pins for value-write handler branches the set/clear suites leave open (security-relevant). */

afterEach(() => { vi.restoreAllMocks(); });

const protectedTarget = { namespace: "core.instructions", key: "custom" };

for (const [label, input] of [["null", null], ["array", []], ["string", "core.presentation.timezone"]] as const) {
  test(`a non-object ${label} input is refused before anything is read`, async () => {
    const f = fixture();
    const find = vi.spyOn(f.settingsRepo, "findActiveDefinition");
    const registration = f.registrations.find((r) => r.descriptor.id === "settings_set_value")!;
    await assert.rejects(
      async () => registration.handler({ executionId: "e", principal: { id: "caller" }, run: { id: "r" }, input, signal: new AbortController().signal }),
      { name: "ToolInputError", message: "settings_set_value: input must be an object containing namespace and key." },
    );
    assert.equal(find.mock.calls.length, 0);
  });
}

test("a whitespace-only namespace is refused as empty", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_clear_value", { namespace: "   ", key: "timezone" }), { name: "ToolInputError", message: "settings_clear_value: 'namespace' must be a non-empty string. Call settings_list_definitions to see valid keys." });
});

test("a non-string key is refused", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_set_value", { namespace: "core.presentation", key: 7, value: "x" }), { name: "ToolInputError", message: "settings_set_value: 'key' must be a non-empty string. Call settings_list_definitions to see valid keys." });
});

test("an explicit workspace scope on a user-only setting names the workspace scope", async () => {
  const f = fixture([definition({ scopes: 4 })]);
  await assert.rejects(() => f.call("settings_set_value", { ...target, scope: "workspace", value: "x" }), { name: "ToolInputError", message: "settings_set_value: 'core.presentation.timezone' can't be set at workspace scope. Call settings_list_definitions to see allowed scopes." });
});

test("JSON that serializes to nothing is refused as invalid JSON", async () => {
  const f = fixture();
  vi.spyOn(JSON, "stringify").mockReturnValueOnce(undefined as unknown as string); // simulates a runtime where stringify yields undefined
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: value must be valid JSON." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("a confirmed protected clear sends no value in the card and clears the override", async () => {
  const requests: SettingsWriteConfirmation[] = [];
  const f = fixture([definition(protectedTarget)], { confirmWrite: async (request) => { requests.push(request); return true; } });
  await f.call("settings_set_value", { ...protectedTarget, value: "old" });
  assert.deepEqual(await f.call("settings_clear_value", protectedTarget), { key: "core.instructions.custom", scope: "workspace", previous: "old", effective: "UTC" });
  assert.equal("value" in requests[1]!, false);
  assert.equal(requests[1]!.previous, "old");
  assert.equal(requests[1]!.toolId, "settings_clear_value");
});

test("a definition version bump during the card makes the confirmation stale", async () => {
  const def = definition(protectedTarget);
  const f = fixture([def], { confirmWrite: async () => {
    // Retype shape: the old version is deprecated and a new active version takes the slot.
    await f.settingsRepo.saveDefinition({ ...def, status: "deprecated" });
    await f.settingsRepo.saveDefinition({ ...def, version: 2 });
    return true;
  } });
  await assert.rejects(() => f.call("settings_set_value", { ...protectedTarget, value: "x" }), { name: "ToolInputError", message: "settings_set_value: this setting changed while the confirmation card was open. Read it again and request a new confirmation. Nothing was changed by this call." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: def.settingId }), []);
});

test("an alias retargeted to another setting during the card makes the confirmation stale", async () => {
  const alias = definition({ settingId: "alias", ...target, status: "alias", aliasOfNamespace: "core.instructions", aliasOfKey: "custom" });
  const f = fixture([alias, definition({ settingId: "first", ...protectedTarget }), definition({ settingId: "second", namespace: "core.instructions", key: "other" })], {
    confirmWrite: async () => { await f.settingsRepo.saveDefinition({ ...alias, aliasOfKey: "other" }); return true; },
    extraConfirmationSettings: [{ namespace: "core.instructions", reason: "Instructions" }],
  });
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: this setting changed while the confirmation card was open. Read it again and request a new confirmation. Nothing was changed by this call." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "first" }), []);
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "second" }), []);
});

test("a run aborted while the card was open writes nothing", async () => {
  const controller = new AbortController();
  const f = fixture([definition(protectedTarget)], { confirmWrite: async () => { controller.abort(); return true; } });
  await assert.rejects(() => f.call("settings_set_value", { ...protectedTarget, value: "x" }, { signal: controller.signal }), { name: "ToolInputError", message: "settings_set_value: the run ended before the change could be applied. Nothing was changed." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("clear reports a null effective value when the definition disappears after the clear", async () => {
  class VanishingRepo extends InMemorySettingsRepo {
    override async saveWorkspaceValue(record: SettingValueRecord): Promise<void> {
      await super.saveWorkspaceValue(record);
      if (record.state === "cleared") await this.saveDefinition(definition({ status: "tombstone" }));
    }
  }
  const settingsRepo = new VanishingRepo({ definitions: [definition()], workspaceValues: [{ settingId: "setting-1", scope: "workspace", workspaceId: "ws-1", principalId: null, valueJson: "old", state: "set", defVersion: 1, seq: 1, updatedBy: "x", updatedAt: "2026-10-01T00:00:00.000Z", originPluginId: null }] });
  const f = fixture(undefined, { settingsRepo });
  assert.deepEqual(await f.call("settings_clear_value", target), { key: "core.presentation.timezone", scope: "workspace", previous: "old", effective: null });
});

test("an infrastructure failure propagates untouched", async () => {
  const f = fixture();
  const failure = new Error("disk unavailable");
  vi.spyOn(f.settingsRepo, "findActiveDefinition").mockRejectedValueOnce(failure);
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), (error) => error === failure);
});

test("a host-denied key is refused before readiness or authorization is awaited", async () => {
  const f = fixture(undefined, { extraDeniedSettings: [{ ...target, reason: "Host restriction" }], settingsReady: new Promise<void>(() => {}) });
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: 'core.presentation.timezone' can't be changed by the assistant: Host restriction. The owner can change it in Settings." });
  assert.equal(f.authorizeCalls.length, 0);
});

test("host confirmation policy replaces the package defaults", async () => {
  const f = fixture([definition(protectedTarget)], { confirmationSettings: [] });
  assert.deepEqual(await f.call("settings_set_value", { ...protectedTarget, value: "x" }), { key: "core.instructions.custom", scope: "workspace", previous: null, value: "x", revisionSeq: 1 });
});

test("a host setValue wrapper performs the write", async () => {
  const setValue = vi.fn(async () => ({ value: "wrapped", revisionSeq: 42 }));
  const f = fixture(undefined, { setValue: setValue as never }); // typed loosely: the fake returns only the fields the handler reads
  assert.deepEqual(await f.call("settings_set_value", { ...target, value: "x" }), { key: "core.presentation.timezone", scope: "workspace", previous: null, value: "wrapped", revisionSeq: 42 });
  assert.equal(setValue.mock.calls.length, 1);
});

test("an empty-string extra input key slips past the unexpected-input check (reported, not fixed)", async () => {
  // The strict boundary tests `if (extra)`, so a key named "" is falsy and never refused.
  // It is ignored downstream, so nothing reads it, but the check is not as strict as its message says.
  const f = fixture();
  assert.deepEqual(await f.call("settings_set_value", { ...target, value: "x", "": "ignored" }), { key: "core.presentation.timezone", scope: "workspace", previous: null, value: "x", revisionSeq: 1 });
});

test("an invalid JSON refusal keeps the serialization failure as its cause", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: NaN }), (error: Error) => error.message === "settings_set_value: value must be valid JSON." && error.cause instanceof Error);
});

test("a cleared override reports previous as null even if the row still carries a value", async () => {
  const f = fixture();
  await f.settingsRepo.saveWorkspaceValue({ settingId: "setting-1", scope: "workspace", workspaceId: "ws-1", principalId: null, valueJson: "stale", state: "cleared", defVersion: 1, seq: 1, updatedBy: "x", updatedAt: "2026-10-01T00:00:00.000Z", originPluginId: null });
  assert.equal((await f.call("settings_set_value", { ...target, value: "new" }) as { previous: unknown }).previous, null);
});

test("a truthy non-true confirmation answer is treated as declined", async () => {
  const f = fixture([definition(protectedTarget)], { confirmWrite: (async () => "yes") as unknown as () => Promise<boolean> }); // malformed host answer on purpose
  await assert.rejects(() => f.call("settings_set_value", { ...protectedTarget, value: "x" }), { name: "ToolInputError", message: "settings_set_value: the human did not confirm the change. Nothing was changed." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});
