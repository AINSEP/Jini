import { expect, test, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { createExecutionSettingsLedger, hasTypedAdminKey, hasUsableAdminKey, reconcileExecutionConfigRefresh } from "../execution-settings-ledger.js";

test("reads, refreshes and diff writes keep both current and previous keys out of the ledger", async () => {
  const defaults: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "https://example.test", model: "old" }, localCli: { agentId: null } };
  const setSetting = vi.fn(async () => {});
  const ledger = createExecutionSettingsLedger({
    defaults,
    port: { getSettingsEffective: async () => [{ key: "byok.apiKey", value: "sk-STORED" }], setSetting },
    isUnregisteredNamespace: () => false,
    reportRestoreFailure: vi.fn(),
  }, {});
  const loaded = await ledger.loadExecutionConfig({}, {});
  expect(loaded.byok.apiKey).toBe("");
  const current = { ...loaded, byok: { ...loaded.byok, apiKey: "sk-TYPED" } };
  const refreshed = reconcileExecutionConfigRefresh({ current, loaded }, {});
  expect(refreshed.byok.apiKey).toBe("sk-TYPED");
  await ledger.saveExecutionConfig({ next: refreshed, previous: loaded }, {});
  expect(setSetting).not.toHaveBeenCalled();
  const next = { ...loaded, byok: { ...loaded.byok, model: "new" } };
  expect(await ledger.saveExecutionConfig({ next, previous: current }, {})).toEqual(["byok.model"]);
  expect(setSetting.mock.calls).toEqual([[{ namespace: "core.execution", key: "byok.model", scope: "workspace", valueJson: "new" }, {}]]);
  expect(JSON.stringify(setSetting.mock.calls)).not.toContain("sk-");
});

test("selected Local CLI values write at user scope and the other fields at workspace scope", async () => {
  const defaults: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
  const setSetting = vi.fn(async () => {});
  const ledger = createExecutionSettingsLedger({ defaults, port: { getSettingsEffective: async () => [], setSetting }, isUnregisteredNamespace: () => false, reportRestoreFailure: vi.fn() }, {});
  const next: ExecutionConfig = { ...defaults, mode: "local-cli", localCli: { agentId: "selected", modelByAgentId: { selected: "model", other: "unused" }, reasoningByAgentId: { selected: "high", other: "low" } } };
  await ledger.saveExecutionConfig({ next, previous: defaults }, {});
  expect(setSetting.mock.calls).toEqual([
    [{ namespace: "core.execution", key: "mode", scope: "workspace", valueJson: "local-cli" }, {}],
    [{ namespace: "core.execution", key: "localCli.agentId", scope: "user", valueJson: "selected" }, {}],
    [{ namespace: "core.execution", key: "localCli.model", scope: "user", valueJson: "model" }, {}],
    [{ namespace: "core.execution", key: "localCli.reasoning", scope: "user", valueJson: "high" }, {}],
  ]);
});

test("distinguishes a typed key from a stored key, treating whitespace as empty", () => {
  expect(hasUsableAdminKey({ apiKey: " fixture ", stored: null })).toBe(true);
  expect(hasUsableAdminKey({ apiKey: " \t ", stored: { isSet: true } })).toBe(true);
  expect(hasUsableAdminKey({ apiKey: " \t ", stored: { isSet: false } })).toBe(false);
  expect(hasUsableAdminKey({ apiKey: "", stored: null })).toBe(false);
  expect(hasTypedAdminKey({ apiKey: " fixture " })).toBe(true);
  expect(hasTypedAdminKey({ apiKey: " \t " })).toBe(false);
});

test("hydrates a concrete token cap without reading key bytes and omits the unset cap", async () => {
  const defaults: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
  const getSettingsEffective = vi.fn()
    .mockResolvedValueOnce([{ key: "byok.maxTokens", value: 4096 }, { key: "byok.apiKey", value: "fixture" }])
    .mockResolvedValueOnce([{ key: "byok.maxTokens", value: 0 }])
    .mockResolvedValueOnce([{ key: "byok.maxTokens", value: "4096" }]);
  const ledger = createExecutionSettingsLedger({ defaults, port: { getSettingsEffective, setSetting: vi.fn() },
    isUnregisteredNamespace: () => false, reportRestoreFailure: vi.fn() });
  expect((await ledger.loadExecutionConfig({})).byok).toEqual({ ...defaults.byok, maxTokens: 4096 });
  expect((await ledger.loadExecutionConfig({})).byok).toStrictEqual(defaults.byok);
  expect((await ledger.loadExecutionConfig({})).byok).toStrictEqual(defaults.byok);
  expect(getSettingsEffective.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ namespace: "core.execution" }, {}]));
});

test("returns defaults only for an unregistered namespace, preserving any other read failure", async () => {
  const defaults: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "default-model" }, localCli: { agentId: null } };
  const cold = new Error("No execution definitions");
  const offline = new Error("Ledger offline");
  const getSettingsEffective = vi.fn().mockRejectedValueOnce(cold).mockRejectedValueOnce(offline);
  const isUnregisteredNamespace = vi.fn(({ error }: { error: unknown }) => error === cold);
  const ledger = createExecutionSettingsLedger({ defaults, port: { getSettingsEffective, setSetting: vi.fn() },
    isUnregisteredNamespace, reportRestoreFailure: vi.fn() });
  await expect(ledger.loadExecutionConfig({})).resolves.toBe(defaults);
  await expect(ledger.loadExecutionConfig({})).rejects.toBe(offline);
  expect(isUnregisteredNamespace.mock.calls).toEqual([[{ error: cold }, {}], [{ error: offline }, {}]]);
});
