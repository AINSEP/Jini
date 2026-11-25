// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { useExecutionConfigLedger } from "../execution-config-ledger.hooks.js";

it("keeps a synchronous local write when a pre-write read settles", async () => {
  const initialConfig: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
  let resolve!: (value: { config: ExecutionConfig; loadedAt: number }) => void;
  const pending = new Promise<{ config: ExecutionConfig; loadedAt: number }>(done => { resolve = done; });
  const configLoader = { load: vi.fn(() => pending), peek: () => undefined, replace: vi.fn() };
  const retry = <T,>({ load }: { load: () => Promise<T>; signal: AbortSignal }) => load();
  const invalidate = vi.fn();
  const configKey = ["settings"];
  const subscribeRefresh = vi.fn(() => () => {});
  const onLoadFailure = vi.fn();
  const { result } = renderHook(() => useExecutionConfigLedger({ io: { current: { now: () => 100 } }, configLoader, invalidate, configKey, initialConfig, retry, subscribeRefresh, onLoadFailure }));
  const picked: ExecutionConfig = { ...initialConfig, mode: "byok" };
  act(() => result.current.setExecutionConfig(picked));
  expect(result.current.executionConfigRef.current).toBe(picked);
  await act(async () => { resolve({ config: initialConfig, loadedAt: 90 }); await pending; });
  await waitFor(() => expect(result.current.configLoaded).toBe(true));
  expect(result.current.executionConfig).toBe(picked);
  configLoader.load.mockResolvedValueOnce({ config: picked, loadedAt: 100 });
  await expect(result.current.readExecutionConfigForSend()).resolves.toBe(picked);
});
