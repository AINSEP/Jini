import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { set } from "../write-service.js";
import { definition, fixture, target } from "./write-tool-fixture.js";

test("workspace and caller-only user writes return previous and persist isolated layers", async () => {
  const f = fixture();
  assert.deepEqual(await f.call("settings_set_value", { ...target, value: "Pacific" }), { key: "core.presentation.timezone", scope: "workspace", previous: null, value: "Pacific", revisionSeq: 1 });
  assert.deepEqual(await f.call("settings_set_value", { ...target, value: "Europe", scope: "user" }), { key: "core.presentation.timezone", scope: "user", previous: null, value: "Europe", revisionSeq: 2 });
  assert.deepEqual(await f.call("settings_set_value", { ...target, value: "Asia", scope: "user" }), { key: "core.presentation.timezone", scope: "user", previous: "Europe", value: "Asia", revisionSeq: 3 });
  assert.equal((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: "setting-1" }))?.valueJson, "Pacific");
  assert.equal((await f.settingsRepo.getUserValue({ workspaceId: "ws-1", principalId: "caller", settingId: "setting-1" }))?.valueJson, "Asia");
  assert.equal(await f.settingsRepo.getUserValue({ workspaceId: "ws-1", principalId: "other", settingId: "setting-1" }), null);
  // The canonical permission helper forwards only supplied optional entity fields.
  assert.deepEqual(f.authorizeCalls[2], { principalId: "caller", permission: "settings.user.self.write", workspaceId: "ws-1", entityType: "setting-value" });
});

for (const [name, defs, input, message] of [
  ["unknown", [], { ...target, value: "x" }, "settings_set_value: setting 'core.presentation.timezone' was not found. Call settings_list_definitions to see valid keys."],
  ["tombstoned", [definition({ status: "tombstone" })], { ...target, value: "x" }, "settings_set_value: setting 'core.presentation.timezone' has been tombstoned. Call settings_list_definitions to see valid keys."],
  ["scope", [definition({ scopes: 2 })], { ...target, scope: "user", value: "x" }, "settings_set_value: 'core.presentation.timezone' can't be set per-user. Call settings_list_definitions to see allowed scopes."],
  ["value", [definition()], { ...target, value: false }, "settings_set_value: value for 'core.presentation.timezone' does not match the definition schema. Call settings_list_definitions and use a value matching the setting's schema."],
] as const) {
  test(`${name} refusal is recoverable and writes nothing`, async () => {
    const f = fixture([...defs]);
    await assert.rejects(() => f.call("settings_set_value", input), { name: "ToolInputError", message });
    assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
  });
}

test("permission denied is readable, and no previous value is read", async () => {
  const f = fixture(undefined, { authorize: async () => ({ allowed: false, reason: "no_grant" }) });
  const read = vi.spyOn(f.settingsRepo, "getWorkspaceValue");
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: permission 'settings.workspace.write' is required. Ask the owner to grant it before retrying." });
  assert.equal(read.mock.calls.length, 0);
});

test("schema and handler forbid global scope, foreign principals and model confirmation", async () => {
  const f = fixture();
  const descriptor = f.registrations.find((r) => r.descriptor.id === "settings_set_value")!.descriptor;
  const schema = descriptor.inputSchema as { additionalProperties: boolean; properties: Record<string, any> };
  assert.equal(descriptor.readOnly, false);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.scope.enum, ["workspace", "user"]);
  assert.equal(schema.properties.principalId, undefined);
  for (const [extra, message] of [
    [{ scope: "global" }, "settings_set_value: scope must be 'workspace' or 'user'; global settings are not writable by this tool."],
    [{ principalId: "other" }, "settings_set_value: unexpected input 'principalId'. Only namespace, key, value, scope are accepted; the caller's own user layer is the only user target."],
    [{ confirmed: true }, "settings_set_value: unexpected input 'confirmed'. Only namespace, key, value, scope are accepted; the caller's own user layer is the only user target."],
  ] as const) await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x", ...extra }), { name: "ToolInputError", message });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

for (const [namespace, key, reason] of [
  ["core.privacy", "telemetry.metrics", "Telemetry consent must record a human decision"],
  ["core.instructions", "custom", "The assistant's own standing instructions are self-modification"],
  ["site.runtime", "mode", "Host runtime policy"],
] as const) {
  test(`${namespace}.${key} fails closed without a human confirmation transport`, async () => {
    const f = fixture([definition({ namespace, key })], { extraConfirmationSettings: [{ namespace: "site.runtime", reason: "Host runtime policy" }] } as any);
    const write = vi.spyOn(f.settingsRepo, "saveWorkspaceValue");
    await assert.rejects(() => f.call("settings_set_value", { namespace, key, value: "x" }), { name: "ToolInputError", message: `settings_set_value: '${namespace}.${key}' requires a human confirmation card: ${reason}. The owner can change it in Settings.` });
    assert.equal(write.mock.calls.length, 0);
  });
}

test("protected write confirms once; ordinary writes never request confirmation", async () => {
  const confirmations: any[] = [];
  const f = fixture([definition(), definition({ settingId: "private", namespace: "core.privacy", key: "telemetry.metrics", schema: { type: "boolean" }, defaultValue: false })], {
    confirmWrite: async (request: any) => { confirmations.push(request); return true; },
  } as any);
  await f.call("settings_set_value", { ...target, value: "x" });
  assert.equal(confirmations.length, 0);
  assert.deepEqual(await f.call("settings_set_value", { namespace: "core.privacy", key: "telemetry.metrics", value: true }), { key: "core.privacy.telemetry.metrics", scope: "workspace", previous: null, value: true, revisionSeq: 2 });
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].value, true);
  assert.equal((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: "private" }))?.valueJson, true);
});

test("confirmWrite receives the invoking transport's execution options (its emitSurface)", async () => {
  const seen: unknown[] = [];
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })], {
    confirmWrite: async (_request: unknown, options?: unknown) => { seen.push(options); return true; },
  } as any);
  const emitSurface = async () => {};
  const registration = f.registrations.find((r) => r.descriptor.id === "settings_set_value")!;
  await registration.handler(
    { executionId: "exec-1", principal: { id: "caller" }, run: { id: "run-1" }, input: { namespace: "core.instructions", key: "custom", value: "x" }, signal: new AbortController().signal },
    { emitSurface },
  );
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { emitSurface?: unknown } | undefined)?.emitSurface, emitSurface);
});

test("declined confirmation and denied host rules cannot write", async () => {
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })], { confirmWrite: async () => false } as any);
  await assert.rejects(() => f.call("settings_set_value", { namespace: "core.instructions", key: "custom", value: "x" }), { name: "ToolInputError", message: "settings_set_value: the human did not confirm the change. Nothing was changed." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
  const denied = fixture(undefined, { extraDeniedSettings: [{ ...target, reason: "Host restriction" }] } as any);
  await assert.rejects(() => denied.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: 'core.presentation.timezone' can't be changed by the assistant: Host restriction. The owner can change it in Settings." });
});

test("definition listing publishes schemas and confirmation policy", async () => {
  const f = fixture([definition(), definition({ settingId: "protected", namespace: "core.instructions", key: "custom" })], { confirmWrite: async () => true } as any);
  const { data } = await f.call("settings_list_definitions", {}) as any;
  assert.deepEqual(data.map((d: any) => [d.namespace, d.agentWritable, d.confirmationRequired, d.schema]), [
    ["core.instructions", true, true, { type: "string" }], ["core.presentation", true, false, { type: "string" }],
  ]);
});

test("definition listing resolves alias schemas, scopes and protected or denied targets", async () => {
  const aliases = [
    definition({ settingId: "alias-private", key: "privacyAlias", status: "alias", aliasOfNamespace: "core.privacy", aliasOfKey: "telemetry.metrics" }),
    definition({ settingId: "alias-denied", key: "deniedAlias", status: "alias", aliasOfNamespace: "site.host", aliasOfKey: "locked" }),
    definition({ settingId: "alias-missing", key: "missingAlias", status: "alias", aliasOfNamespace: "site.missing", aliasOfKey: "unknown" }),
    definition({ settingId: "alias-tombstone", key: "removedAlias", status: "alias", aliasOfNamespace: "site.host", aliasOfKey: "removed" }),
  ];
  const f = fixture([
    ...aliases,
    definition({ settingId: "private", namespace: "core.privacy", key: "telemetry.metrics", schema: { type: "boolean" }, defaultValue: false, scopes: 2 }),
    definition({ settingId: "locked", namespace: "site.host", key: "locked", workspaceId: "ws-1", ownerKind: "site" }),
    definition({ settingId: "removed", namespace: "site.host", key: "removed", workspaceId: "ws-1", ownerKind: "site", status: "tombstone" }),
  ], { extraDeniedSettings: [{ namespace: "site.host", key: "locked", reason: "Host restriction" }] });
  const { data } = await f.call("settings_list_definitions", {}) as { data: Array<Record<string, unknown>> };
  const row = (key: string) => data.find((entry) => entry.key === key)!;
  assert.deepEqual([row("privacyAlias").agentWritable, row("privacyAlias").confirmationRequired, row("privacyAlias").schema, row("privacyAlias").scopes], [false, true, { type: "boolean" }, 2]);
  for (const key of ["deniedAlias", "missingAlias", "removedAlias"]) assert.equal(row(key).agentWritable, false, key);
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "private" }), []);
});

test("an ordinary-looking alias cannot bypass the protected target's card", async () => {
  const f = fixture([
    definition({ settingId: "alias", status: "alias", aliasOfNamespace: "core.instructions", aliasOfKey: "custom" }),
    definition({ namespace: "core.instructions", key: "custom" }),
  ]);
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x" }), { name: "ToolInputError", message: "settings_set_value: 'core.instructions.custom' requires a human confirmation card: The assistant's own standing instructions are self-modification. The owner can change it in Settings." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("a concurrent edit makes the confirmation stale and preserves that edit", async () => {
  const def = definition({ namespace: "core.instructions", key: "custom" });
  const f = fixture([def], {
    confirmWrite: async () => {
      await set({ deps: { repo: f.settingsRepo, authorize: f.deps.authorize, principals: f.deps.principalRepo, clock: f.deps.clock, ids: f.deps.idGen }, input: { namespace: def.namespace, key: def.key, scope: "workspace", value: "human edit", workspaceId: "ws-1", authWorkspaceId: "ws-1", callerPrincipalId: "caller" } });
      return true;
    },
  } as any);
  await assert.rejects(() => f.call("settings_set_value", { namespace: def.namespace, key: def.key, value: "agent edit" }), { name: "ToolInputError", message: "settings_set_value: this setting changed while the confirmation card was open. Read it again and request a new confirmation. Nothing was changed by this call." });
  assert.equal((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: def.settingId }))?.valueJson, "human edit");
  assert.equal((await f.settingsRepo.listRevisions({ settingId: def.settingId })).length, 1);
});

test("the confirmed JSON value is a snapshot, unaffected by callback or caller mutation", async () => {
  const value = { text: "original" };
  const f = fixture([definition({ namespace: "core.instructions", key: "custom", schema: { type: "json" }, defaultValue: {} })], {
    confirmWrite: async (request: any) => { value.text = "caller mutation"; request.value.text = "adapter mutation"; return true; },
  } as any);
  const result = await f.call("settings_set_value", { namespace: "core.instructions", key: "custom", value }) as any;
  assert.deepEqual(result.value, { text: "original" });
  assert.deepEqual((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: "setting-1" }))?.valueJson, { text: "original" });
});

test("null scope and missing coordinates are readable refusals without a write", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_set_value", { ...target, value: "x", scope: null }), { name: "ToolInputError", message: "settings_set_value: scope must be 'workspace' or 'user'; global settings are not writable by this tool." });
  for (const field of ["namespace", "key"] as const) {
    const input: Record<string, unknown> = { ...target, value: "x" };
    delete input[field];
    await assert.rejects(() => f.call("settings_set_value", input), { name: "ToolInputError", message: `settings_set_value: '${field}' must be a non-empty string. Call settings_list_definitions to see valid keys.` });
  }
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("false, zero, null, empty string and structured JSON round-trip as values", async () => {
  const f = fixture([definition({ schema: { type: "json", nullable: true }, defaultValue: {} })]);
  let previous: unknown = null;
  for (const [i, value] of [false, 0, null, "", { nested: [1, true, null] }].entries()) {
    assert.deepEqual(await f.call("settings_set_value", { ...target, value }), { key: "core.presentation.timezone", scope: "workspace", previous, value, revisionSeq: i + 1 });
    assert.deepEqual((await f.settingsRepo.getWorkspaceValue({ workspaceId: "ws-1", settingId: "setting-1" }))?.valueJson, value);
    previous = value;
  }
});

test("missing and non-JSON values fail before mutating anything", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("settings_set_value", target), { name: "ToolInputError", message: "settings_set_value: a JSON 'value' is required." });
  const cycle: any = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, { nested: undefined }, cycle]) await assert.rejects(() => f.call("settings_set_value", { ...target, value }), { name: "ToolInputError", message: "settings_set_value: value must be valid JSON." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("an already-aborted protected call cannot open a card", async () => {
  const confirmWrite = vi.fn(async () => true);
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })], { confirmWrite });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.call("settings_set_value", { namespace: "core.instructions", key: "custom", value: "new" }, { signal: controller.signal }), { name: "ToolInputError", message: "settings_set_value: the run ended before the change could be applied. Nothing was changed." });
  assert.equal(confirmWrite.mock.calls.length, 0);
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("aborting during authorization cannot open a protected card afterwards", async () => {
  const controller = new AbortController();
  const confirmWrite = vi.fn(async () => true);
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })], {
    confirmWrite,
    authorize: async () => { controller.abort(); return { allowed: true, reason: "matched" }; },
  });
  await assert.rejects(() => f.call("settings_set_value", { namespace: "core.instructions", key: "custom", value: "new" }, { signal: controller.signal }), { name: "ToolInputError", message: "settings_set_value: the run ended before the change could be applied. Nothing was changed." });
  assert.equal(confirmWrite.mock.calls.length, 0);
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});

test("permission revoked while a card is open is checked again before writing", async () => {
  let allowed = true;
  const f = fixture([definition({ namespace: "core.instructions", key: "custom" })], {
    authorize: async () => ({ allowed, reason: allowed ? "matched" : "no_grant" }),
    confirmWrite: async () => { allowed = false; return true; },
  });
  await assert.rejects(() => f.call("settings_set_value", { namespace: "core.instructions", key: "custom", value: "new" }), { name: "ToolInputError", message: "settings_set_value: permission 'settings.workspace.write' is required. Ask the owner to grant it before retrying." });
  assert.deepEqual(await f.settingsRepo.listRevisions({ settingId: "setting-1" }), []);
});
