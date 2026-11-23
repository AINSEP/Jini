import { describe, expect, it, vi } from "vitest";
import type { ChatPaneAgent, ChatPaneAgentSelection } from "../../../../react/kit.js";
import { isSelectionNormalizationEcho } from "../local-cli-selection-echo.js";

/**
 * The helper's own decision rule, over an injected deterministic resolver: it fills a missing model
 * with `"default-model"` and a missing effort with `"default"`, nothing else. The host keeps the
 * parity cases that run the chat library's real `resolveChatPaneSelection` (Tovu's
 * `local-cli-selection-echo.unit.test.ts`); these pin what the helper does with whatever it returns.
 */
function fakeResolver() {
  return vi.fn(({ requested }: { agents: readonly ChatPaneAgent[]; requested: ChatPaneAgentSelection }) => ({
    agentId: requested.agentId,
    model: requested.model ?? "default-model",
    reasoning: requested.reasoning ?? "default",
  }));
}

const agents: ChatPaneAgent[] = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }];

describe("isSelectionNormalizationEcho (injected resolver)", () => {
  it("is true when both values resolve to the same agent, model and effort", () => {
    const resolveChatPaneSelection = fakeResolver();
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha" },
      incoming: { agentId: "alpha", model: "default-model", reasoning: "default" }, agents, resolveChatPaneSelection,
    })).toBe(true);
    expect(resolveChatPaneSelection.mock.calls).toEqual([
      [{ agents, requested: { agentId: "alpha" } }],
      [{ agents, requested: { agentId: "alpha", model: "default-model", reasoning: "default" } }],
    ]);
  });

  it("is false when only the resolved agent differs", () => {
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha", model: "m", reasoning: "r" },
      incoming: { agentId: "beta", model: "m", reasoning: "r" }, agents, resolveChatPaneSelection: fakeResolver(),
    })).toBe(false);
  });

  it("is false when only the resolved model differs", () => {
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha", model: "m1", reasoning: "r" },
      incoming: { agentId: "alpha", model: "m2", reasoning: "r" }, agents, resolveChatPaneSelection: fakeResolver(),
    })).toBe(false);
  });

  it("is false when only the resolved effort differs (an operator effort pick is saved)", () => {
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha", model: "m", reasoning: "high" },
      incoming: { agentId: "alpha", model: "m", reasoning: "default" }, agents, resolveChatPaneSelection: fakeResolver(),
    })).toBe(false);
  });

  it("is true for an effort-only fill-in the resolver produces for both sides", () => {
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha", model: "m" },
      incoming: { agentId: "alpha", model: "m", reasoning: "default" }, agents, resolveChatPaneSelection: fakeResolver(),
    })).toBe(true);
  });

  it.each([
    { label: "unknown", inventory: undefined },
    { label: "empty", inventory: [] },
  ])("is false with an $label inventory and never calls the resolver", ({ inventory }) => {
    const resolveChatPaneSelection = fakeResolver();
    expect(isSelectionNormalizationEcho({
      current: { agentId: "alpha" },
      incoming: { agentId: "alpha", model: "default-model", reasoning: "default" },
      agents: inventory, resolveChatPaneSelection,
    })).toBe(false);
    expect(resolveChatPaneSelection).not.toHaveBeenCalled();
  });
});
