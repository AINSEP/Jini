// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { useLocalCliSelection } from "../local-cli-selection.hooks.js";

it("shows a normalization echo without persisting it", () => {
  const executionConfig: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: "agent" } };
  const persistWrite = vi.fn(async () => true);
  const applyChange = vi.fn(() => null);
  const input: Parameters<typeof useLocalCliSelection>[0] = { executionConfig, setExecutionConfig: vi.fn(), configLoaded: true, initialSelection: { agentId: "agent" }, readAgentsSnapshot: () => [{ id: "agent", name: "Agent" }], resolveChatPaneSelection: ({ requested }) => ({ ...requested, model: "default" }), readSavedSelection: () => ({ agentId: "agent" }), withSelection: ({ previous }) => previous, applyChange, persistWrite };
  const { result } = renderHook(() => useLocalCliSelection(input));
  act(() => result.current.handleLocalCliSelectionChange({ agentId: "agent", model: "default" }));
  expect(result.current.localCliSelection).toEqual({ agentId: "agent", model: "default" });
  expect(applyChange).not.toHaveBeenCalled();
  expect(persistWrite).not.toHaveBeenCalled();
});

it("keeps a new picker choice while its save is pending even after an older save succeeds", async () => {
  const base: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: "ledger" } };
  const savedAs = (agentId: string): ExecutionConfig => ({ ...base, localCli: { agentId } });
  const settled: ((saved: boolean) => void)[] = [];
  const persistWrite = vi.fn<Parameters<typeof useLocalCliSelection>[0]["persistWrite"]>(() =>
    new Promise(resolve => { settled.push(resolve); }));
  let current = base;
  const setExecutionConfig: Parameters<typeof useLocalCliSelection>[0]["setExecutionConfig"] = action => {
    current = typeof action === "function" ? action(current) : action;
  };
  const applyChange: Parameters<typeof useLocalCliSelection>[0]["applyChange"] = ({ change, setExecutionConfig: set }) => {
    const previous = current;
    const next = change(previous);
    if (next === previous) return null;
    set(next);
    return { previous, next };
  };
  // Injected ports are stable across renders, as the dock's module-level functions are: a fresh
  // `readSavedSelection` per render re-runs the sync effect every render and never settles.
  const stable: Omit<Parameters<typeof useLocalCliSelection>[0], "executionConfig"> = {
    setExecutionConfig, configLoaded: true, initialSelection: { agentId: "initial" }, readAgentsSnapshot: () => undefined,
    resolveChatPaneSelection: ({ requested }) => requested, readSavedSelection: ({ config }) => ({ agentId: config.localCli.agentId ?? "default" }),
    withSelection: ({ previous, selection }) => ({ ...previous, localCli: { agentId: selection.agentId } }), applyChange, persistWrite,
  };
  const { result, rerender } = renderHook((executionConfig: ExecutionConfig) => useLocalCliSelection({ executionConfig, ...stable }),
    { initialProps: base });
  expect(result.current.localCliSelection).toEqual({ agentId: "ledger" });
  act(() => result.current.handleLocalCliSelectionChange({ agentId: "first" }));
  act(() => result.current.handleLocalCliSelectionChange({ agentId: "second" }));
  expect(persistWrite.mock.calls).toEqual([
    [{ write: { previous: base, next: savedAs("first") } }],
    [{ write: { previous: savedAs("first"), next: savedAs("second") } }],
  ]);
  await act(async () => { settled[0]!(true); });
  rerender(savedAs("older-server-view"));
  expect(result.current.localCliSelection).toEqual({ agentId: "second" });
  expect(result.current.readLocalCliSelectionForSend?.(savedAs("older-server-view"))).toEqual({ agentId: "second" });
  await act(async () => { settled[1]!(true); });
  rerender(savedAs("external"));
  expect(result.current.localCliSelection).toEqual({ agentId: "external" });
});
