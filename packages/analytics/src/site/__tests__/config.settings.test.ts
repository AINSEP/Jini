import type { JsonValue } from "@jini-ai/core/primitives";
import { InMemorySettingsRepo, registerDefinitions, set, SCOPE_BIT, type SettingValueSchema } from "@jini-ai/core/settings";
import { expect, it } from "vitest";

import { createSettingsAnalyticsConfig, ensureAnalyticsSettingDefinitions } from "../config.settings.js";

const namespace = "core.analytics";
const workspaceId = "site-workspace";
const systemPrincipalId = "boot-principal";
const defaults = {
  workspaceId, enabled: true, honorDoNotTrack: true, honorGlobalPrivacyControl: true,
  rawRetentionDays: 30, excludedPaths: [], excludedIpRanges: [], sink: "local",
};

function ledger(settingsRepo = new InMemorySettingsRepo()) {
  let id = 0;
  const deps = {
    settingsRepo,
    clock: { nowMs: () => Date.parse("2026-11-01T10:00:00.000Z") },
    ids: { newId: () => `setting-${++id}` },
    principals: { findActiveById: async () => null },
  };
  const writeDeps = { ...deps, repo: settingsRepo, authorize: async () => ({ allowed: true, reason: "test grant" }) };
  return {
    config: createSettingsAnalyticsConfig({ settingsRepo }),
    ensure: () => ensureAnalyticsSettingDefinitions(deps, { systemPrincipalId }),
    writeDeps,
    put: (key: string, value: JsonValue) => set({
      deps: writeDeps,
      input: { namespace, key, value, workspaceId, scope: "workspace", callerPrincipalId: systemPrincipalId },
    }),
  };
}

it("registers seven core workspace-scoped defaults and does not duplicate boot revisions", async () => {
  const repo = new InMemorySettingsRepo();
  const { config, ensure } = ledger(repo);
  await ensure();
  await ensure();
  const definitions = await repo.listActiveDefinitions({ workspaceId: null });
  expect(definitions.map(({ key }) => key).sort()).toEqual([
    "enabled", "excludedIpRanges", "excludedPaths", "honorDoNotTrack", "honorGlobalPrivacyControl", "rawRetentionDays", "sink",
  ]);
  expect(Object.fromEntries(definitions.map(({ key, schema, defaultValue }) => [key, [schema.type, defaultValue]]))).toEqual({
    enabled: ["boolean", true], honorDoNotTrack: ["boolean", true], honorGlobalPrivacyControl: ["boolean", true],
    rawRetentionDays: ["number", 30], excludedPaths: ["json", []], excludedIpRanges: ["json", []], sink: ["string", "local"],
  });
  for (const definition of definitions) {
    expect(definition).toMatchObject({ namespace, ownerKind: "core", workspaceId: null, scopes: SCOPE_BIT.workspace, secret: false });
    const revisions = await repo.listRevisions({ settingId: definition.settingId });
    expect(revisions.map(({ op, actor }) => ({ op, actor }))).toEqual([{ op: "register", actor: systemPrincipalId }]);
  }
  expect(await config.get({ workspaceId })).toEqual(defaults);
});

it("uses the privacy-preserving boot fallback even when only the final definition is missing", async () => {
  class IncompleteBootRepo extends InMemorySettingsRepo {
    override async findActiveDefinition(required: Parameters<InMemorySettingsRepo["findActiveDefinition"]>[0]) {
      if (required.namespace === namespace && required.key === "sink") return null;
      return super.findActiveDefinition(required);
    }
  }
  const { config, ensure, put } = ledger(new IncompleteBootRepo());
  await ensure();
  await put("enabled", false);
  await put("honorDoNotTrack", false);
  expect(await config.get({ workspaceId })).toEqual(defaults);
});

it("reads current workspace values, filters mixed JSON arrays, and trims the named sink", async () => {
  const { config, ensure, put } = ledger();
  await ensure();
  expect(await config.get({ workspaceId })).toEqual(defaults);
  await put("enabled", false);
  await put("honorDoNotTrack", false);
  await put("honorGlobalPrivacyControl", false);
  await put("rawRetentionDays", 9);
  await put("excludedPaths", ["/admin/*", 7, false, "/health"]);
  await put("excludedIpRanges", ["192.0.2.0/24", { label: "invalid" }]);
  await put("sink", "  regional-collector  ");
  expect(await config.get({ workspaceId })).toEqual({
    workspaceId, enabled: false, honorDoNotTrack: false, honorGlobalPrivacyControl: false,
    rawRetentionDays: 9, excludedPaths: ["/admin/*", "/health"], excludedIpRanges: ["192.0.2.0/24"], sink: "regional-collector",
  });
  expect(await config.get({ workspaceId: "another-workspace" })).toEqual({ ...defaults, workspaceId: "another-workspace" });
  await put("sink", "  \t ");
  expect((await config.get({ workspaceId })).sink).toBe("local");
});

it("normalizes null, non-array, and legacy type mismatches from the ledger", async () => {
  const { config, put, writeDeps } = ledger();
  // An older host can have stored/schema-validated values with different types.
  const legacyDefinitions: { key: string; schema: SettingValueSchema; defaultValue: JsonValue }[] = [
    { key: "enabled", schema: { type: "string" }, defaultValue: "yes" },
    { key: "honorDoNotTrack", schema: { type: "boolean" }, defaultValue: true },
    { key: "honorGlobalPrivacyControl", schema: { type: "boolean" }, defaultValue: true },
    { key: "rawRetentionDays", schema: { type: "string" }, defaultValue: "75" },
    { key: "excludedPaths", schema: { type: "json", nullable: true }, defaultValue: { glob: "/admin" } },
    { key: "excludedIpRanges", schema: { type: "json", nullable: true }, defaultValue: ["192.0.2.1"] },
    { key: "sink", schema: { type: "number" }, defaultValue: 42 },
  ];
  await registerDefinitions({ deps: writeDeps, input: {
    callerPrincipalId: systemPrincipalId,
    authWorkspaceId: workspaceId,
    definitions: legacyDefinitions.map((definition) => ({
      ...definition,
      namespace, workspaceId: null, ownerKind: "core", scopes: SCOPE_BIT.workspace, secret: false,
    })),
  } });
  expect(await config.get({ workspaceId })).toEqual({ ...defaults, enabled: false, excludedIpRanges: ["192.0.2.1"] });
  await put("excludedPaths", null);
  await put("excludedIpRanges", null);
  expect(await config.get({ workspaceId })).toEqual({ ...defaults, enabled: false });
});
