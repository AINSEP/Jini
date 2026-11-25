import { expect, test, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { createExecutionSettingsLedger } from "../execution-settings-ledger.js";

test("restores only successful keys in reverse order and rethrows the original failure", async () => {
  const defaults: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
  const failure = new Error("write refused");
  const rollbackFailure = new Error("restore refused");
  const reportRestoreFailure = vi.fn();
  const setSetting = vi.fn(async (_input: { key: string; valueJson: unknown }) => {});
  setSetting.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure).mockRejectedValueOnce(rollbackFailure).mockResolvedValueOnce(undefined);
  const ledger = createExecutionSettingsLedger({ defaults, port: { getSettingsEffective: async () => [], setSetting }, isUnregisteredNamespace: () => false, reportRestoreFailure }, {});
  const next: ExecutionConfig = { ...defaults, mode: "local-cli", byok: { ...defaults.byok, protocol: "google", model: "new" } };
  await expect(ledger.saveExecutionConfig({ next, previous: defaults }, {})).rejects.toBe(failure);
  expect(setSetting.mock.calls.map(([input]) => [input.key, input.valueJson])).toEqual([
    ["mode", "local-cli"], ["byok.protocol", "google"], ["byok.model", "new"],
    ["byok.protocol", "openai"], ["mode", "byok"],
  ]);
  expect(reportRestoreFailure).toHaveBeenCalledWith({ error: rollbackFailure }, {});
});
