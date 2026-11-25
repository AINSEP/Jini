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
