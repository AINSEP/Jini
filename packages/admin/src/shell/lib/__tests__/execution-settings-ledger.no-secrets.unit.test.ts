import { expect, test, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { createExecutionSettingsLedger, reconcileExecutionConfigRefresh } from "../execution-settings-ledger.js";

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
