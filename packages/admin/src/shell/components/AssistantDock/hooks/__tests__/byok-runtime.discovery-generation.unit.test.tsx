// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { useByokModels, useByokRuntime } from "../byok-runtime.hooks.js";

it("discards a discovery that settles after its endpoint changed", async () => {
  const config: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "saved", baseUrl: "first", model: "" }, localCli: { agentId: null } };
  let resolve!: (value: readonly string[]) => void;
  const pending = new Promise<readonly string[]>(done => { resolve = done; });
  const listModels = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(["current"]);
  const createPort = () => ({ listModels });
  const { result, rerender } = renderHook(({ executionConfig }) => useByokModels({ executionConfig, createPort }), { initialProps: { executionConfig: config } });
  await act(async () => { rerender({ executionConfig: { ...config, byok: { ...config.byok, baseUrl: "second" } } }); });
  expect(result.current).toEqual([{ id: "current", label: "current" }]);
  await act(async () => { resolve(["obsolete"]); await pending; });
  expect(result.current).toEqual([{ id: "current", label: "current" }]);
});

it("clears discovered models when BYOK is disabled and does not probe a whitespace-only credential", async () => {
  const config: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "fixture", baseUrl: "https://models.example", model: "" }, localCli: { agentId: null } };
  const listModels = vi.fn(async () => ["server-model"]);
  const createPort = () => ({ listModels });
  const { result, rerender } = renderHook((executionConfig: ExecutionConfig) => useByokModels({ executionConfig, createPort }), { initialProps: config });
  await act(async () => {});
  expect(result.current).toEqual([{ id: "server-model", label: "server-model" }]);
  rerender({ ...config, mode: "local-cli" });
  expect(result.current).toEqual([]);
  rerender({ ...config, byok: { ...config.byok, apiKey: " \t " } });
  expect(result.current).toEqual([]);
  expect(listModels.mock.calls).toEqual([[config.byok]]);
});

it("labels the exact provider preset, persists only a changed model, and leaves custom endpoints unbranded", () => {
  const initial: ExecutionConfig = {
    mode: "byok", byok: { protocol: "openai", providerId: "gateway", apiKey: "", baseUrl: "https://gateway.example", model: "small" },
    localCli: { agentId: null },
  };
  const presets = [{ id: "gateway", title: "Gateway", protocol: "openai", baseUrl: "https://gateway.example", preferredModels: [] }] as const;
  const models = [{ id: "large", label: "Large from host" }];
  const persistWrite = vi.fn(async () => true);
  const applyChange: Parameters<typeof useByokRuntime>[0]["applyChange"] = ({ setExecutionConfig, change }) => {
    const next = change(initial);
    if (next === initial) return null;
    setExecutionConfig(next);
    return { previous: initial, next };
  };
  const setExecutionConfig = vi.fn();
  const { result, rerender } = renderHook((executionConfig: ExecutionConfig) => useByokRuntime({
    executionConfig, setExecutionConfig, createPort: () => ({}), useModelsHook: () => models, presets,
    resolvePreset: ({ presets: available, config }) => available.find(preset => preset.id === config.providerId && preset.baseUrl === config.baseUrl),
    presetIconIds: { gateway: "gateway-icon" }, applyChange, persistWrite,
  }), { initialProps: initial });
  expect(result.current.byokRuntime).toEqual({ providerLabel: "Gateway", iconId: "gateway-icon", model: "small", models });
  act(() => result.current.handleByokModelChange("small"));
  expect(persistWrite).not.toHaveBeenCalled();
  expect(setExecutionConfig).not.toHaveBeenCalled();
  act(() => result.current.handleByokModelChange("large"));
  const next = { ...initial, byok: { ...initial.byok, model: "large" } };
  expect(setExecutionConfig).toHaveBeenCalledExactlyOnceWith(next);
  expect(persistWrite).toHaveBeenCalledExactlyOnceWith({ write: { previous: initial, next } });
  rerender({ ...next, byok: { ...next.byok, providerId: null, baseUrl: "https://custom.example" } });
  expect(result.current.byokRuntime).toEqual({ model: "large", models });
});
