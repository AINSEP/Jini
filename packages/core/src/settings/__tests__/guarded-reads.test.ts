import { describe, expect, test, vi } from "vitest";

import { readEffectiveFailClosed, readUserLayerObject } from "../guarded-reads.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { getEffective } from "../settings.js";
import { SCOPE_BIT, type SettingDefinitionRecord, type SettingValueRecord } from "../types.js";
import type { JsonValue } from "../../primitives/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
const definition: SettingDefinitionRecord = {
  settingId: "setting-1", version: 1, workspaceId: null, namespace: "core.grants", key: "layer", ownerKind: "core",
  ownerId: null, schema: { type: "json" }, defaultValue: {}, scopes: SCOPE_BIT.workspace | SCOPE_BIT.user, secret: false,
  status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW,
};

function userRow(valueJson: JsonValue | null, state: SettingValueRecord["state"] = "set"): SettingValueRecord {
  return { settingId: "setting-1", scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson, state,
    defVersion: 1, seq: 7, updatedBy: "p-1", updatedAt: NOW, originPluginId: null };
}

async function repoWith(row?: SettingValueRecord): Promise<InMemorySettingsRepo> {
  const repo = new InMemorySettingsRepo();
  await repo.saveDefinition(definition);
  if (row) await repo.saveUserValue(row);
  return repo;
}

const target = { namespace: "core.grants", key: "layer", workspaceId: "ws-1", principalId: "p-1", notReadyMessage: "Not ready yet." };

describe("readUserLayerObject", () => {
  test("returns the principal's own stored object and its revision", async () => {
    const settingsRepo = await repoWith(userRow({ enabled: true, byAgent: { a: { enabled: false } } }));
    expect(await readUserLayerObject({ settingsRepo, ...target })).toEqual({ raw: { enabled: true, byAgent: { a: { enabled: false } } }, revisionSeq: 7 });
  });

  test.each<[string, SettingValueRecord | undefined, number]>([
    ["missing row", undefined, 0],
    ["cleared row", userRow({ enabled: true }, "cleared"), 7],
    ["array value", userRow([true]), 7],
    ["scalar value", userRow("on"), 7],
    ["null value", userRow(null), 7],
  ])("%s reads as an empty object", async (_label, row, revisionSeq) => {
    const settingsRepo = await repoWith(row);
    expect(await readUserLayerObject({ settingsRepo, ...target })).toEqual({ raw: {}, revisionSeq });
  });

  test("another principal's row is never read", async () => {
    const settingsRepo = await repoWith(userRow({ enabled: true }));
    expect(await readUserLayerObject({ settingsRepo, ...target, principalId: "p-2" })).toEqual({ raw: {}, revisionSeq: 0 });
  });

  test("an unregistered definition throws the host's message", async () => {
    await expect(readUserLayerObject({ settingsRepo: new InMemorySettingsRepo(), ...target })).rejects.toThrow(/^Not ready yet\.$/);
  });
});

describe("readEffectiveFailClosed", () => {
  const base = async () => ({
    settingsRepo: await repoWith(userRow({ enabled: true })), getEffective, settingsReady: Promise.resolve(),
    namespace: "core.grants", key: "layer", scopeContext: { workspaceId: "ws-1", principalId: "p-1" },
    denied: () => "denied", deniedWarning: "safe diagnostic", warn: vi.fn(),
  });

  test("projects the freshly resolved setting", async () => {
    const required = await base();
    const result = await readEffectiveFailClosed({ ...required, project: ({ setting }) => JSON.stringify(setting) });
    expect(result).toBe(JSON.stringify({ value: { enabled: true }, sourceLayer: "user", defVersion: 1 }));
    expect(required.warn).not.toHaveBeenCalled();
  });

  test("passes null for an unregistered setting", async () => {
    const required = { ...await base(), settingsRepo: new InMemorySettingsRepo() };
    expect(await readEffectiveFailClosed({ ...required, project: async ({ setting }) => String(setting) })).toBe("null");
  });

  test.each([
    ["readiness", () => ({ settingsReady: Promise.reject(new Error("secret-ready")) }), (): string => "never"],
    ["projection", () => ({}), (): string => { throw new Error("secret-project"); }],
  ] as const)("a %s failure denies and logs only the host diagnostic", async (_label, override, project) => {
    const required = { ...await base(), ...override() };
    expect(await readEffectiveFailClosed({ ...required, project })).toBe("denied");
    expect(required.warn).toHaveBeenCalledExactlyOnceWith("safe diagnostic");
  });

  test("readFailure throw propagates the original error without logging", async () => {
    const required = await base();
    const failure = new Error("storage down");
    const broken = { ...required, getEffective: (async () => { throw failure; }) as typeof getEffective };
    await expect(readEffectiveFailClosed({ ...broken, project: () => "never" }, { readFailure: "throw" })).rejects.toBe(failure);
    expect(required.warn).not.toHaveBeenCalled();
  });
});
