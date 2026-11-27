// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen } from "../../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { formatUserFacingError } from "@jini-ai/core";
import { isAbortError } from "@jini-ai/core/text";

import type { ChatPaneRuntimeAccess, ChatTransport, KitChatTranslator } from "../../../../react/kit.js";
import { AgentFailureCard } from "../AgentFailureCard.js";
import { FailureSurfaceContext, hasAgentFailureNotice, useAgentFailureCard, useAgentFailureSurface, type FailureSurfaceActions } from "../AgentFailureCard.hooks.js";
import { GENERIC_AGENT_FAILURE, type AgentFailureHint } from "../agent-failure.js";
import { GEMINI_INELIGIBLE_HINT, localFailureHints } from "../agent-failure-hints.js";

type Agents = Awaited<ReturnType<ChatPaneRuntimeAccess["listAgents"]>>;

/** Marks translated copy and interpolates `{name}`, so assertions prove the translator was used. */
const t: KitChatTranslator = (key, vars) => `«${key.replace("{name}", String(vars?.name ?? "{name}"))}»`;
const useTHook = () => t;

function withSurface(actions: FailureSurfaceActions) {
  return function Surface({ children }: { children: ReactNode }) {
    return createElement(FailureSurfaceContext.Provider, { value: actions }, children);
  };
}

const geminiFailure = { reason: "IneligibleTierError: account", details: "IneligibleTierError: account tier", agentId: "gemini" };

describe("localFailureHints", () => {
  it("adds the Gemini sign-in hint only for the gemini agent", () => {
    expect(localFailureHints({ agentId: "gemini" })).toEqual([GEMINI_INELIGIBLE_HINT]);
    expect(localFailureHints({ agentId: "claude" })).toEqual([]);
    expect(localFailureHints({ agentId: undefined })).toEqual([]);
  });
});

describe("hasAgentFailureNotice", () => {
  it("reads only the last event, and only a well-formed failure", () => {
    expect(hasAgentFailureNotice({ events: [] })).toBe(false);
    expect(hasAgentFailureNotice({ events: ["text"] })).toBe(false);
    expect(hasAgentFailureNotice({ events: [{ reason: "x" }] })).toBe(false);
    expect(hasAgentFailureNotice({ events: [{ reason: GENERIC_AGENT_FAILURE, details: "d" }, "later"] })).toBe(false);
    expect(hasAgentFailureNotice({ events: [{ reason: GENERIC_AGENT_FAILURE, details: "d" }] })).toBe(true);
  });
});

describe("useAgentFailureCard", () => {
  it("is null while streaming, after success, or without a failure", () => {
    const events = [{ reason: GENERIC_AGENT_FAILURE, details: "d" }];
    expect(renderHook(() => useAgentFailureCard({ events, runStreaming: true, runSucceeded: false, useTHook })).result.current).toBeNull();
    expect(renderHook(() => useAgentFailureCard({ events, runStreaming: false, runSucceeded: true, useTHook })).result.current).toBeNull();
    expect(renderHook(() => useAgentFailureCard({ events: [], runStreaming: false, runSucceeded: false, useTHook })).result.current).toBeNull();
  });

  it("keeps the generic reason, redacting its details, with no hint or switch", () => {
    const { result } = renderHook(() => useAgentFailureCard({ events: [{ reason: GENERIC_AGENT_FAILURE, details: "Authorization: Bearer abc123" }], runStreaming: false, runSucceeded: false, useTHook }));
    expect(result.current).toMatchObject({ reason: GENERIC_AGENT_FAILURE, details: "Authorization: Bearer [REDACTED]", hint: undefined, switchLabel: undefined, switchAgent: undefined });
    expect(result.current).not.toHaveProperty("agentId");
  });

  it("matches the local Gemini hint and offers a switch to an available suggested agent", () => {
    const switchAgent = vi.fn();
    const agents = [{ id: "antigravity", name: "Antigravity", available: true }];
    const { result } = renderHook(() => useAgentFailureCard({ events: [geminiFailure], runStreaming: false, runSucceeded: false, useTHook }), { wrapper: withSurface({ agents, switchAgent }) });
    expect(result.current?.agentId).toBe("gemini");
    expect(result.current?.hint).toBe(`«${GEMINI_INELIGIBLE_HINT.hint}»`);
    expect(result.current?.switchLabel).toBe("«Switch to Antigravity»");
    result.current?.switchAgent?.();
    expect(switchAgent).toHaveBeenCalledWith({ agentId: "antigravity" });
  });

  it("prefers the agent's declared hints and offers no switch when the suggestion is unavailable", () => {
    const declared: AgentFailureHint = { category: "auth", patterns: ["login expired"], hint: "Sign in again.", suggestedAgentId: "other" };
    const agents = [{ id: "codex", name: "Codex", available: true, failureHints: [declared] }, { id: "other", name: "Other", available: false }];
    const events = [{ reason: "Error: login expired", details: "Error: login expired", agentId: "codex" }];
    const { result } = renderHook(() => useAgentFailureCard({ events, runStreaming: false, runSucceeded: false, useTHook }), { wrapper: withSurface({ agents, switchAgent: vi.fn() }) });
    expect(result.current?.hint).toBe("«Sign in again.»");
    expect(result.current?.switchAgent).toBeUndefined();
  });
});

describe("useAgentFailureSurface", () => {
  function setup() {
    const onSelectionChange = vi.fn();
    const onExecutionModeChange = vi.fn();
    const inventories: Array<(agents: Agents) => void> = [];
    const runtimeAccess: ChatPaneRuntimeAccess = {
      listAgents: () => new Promise<Agents>((resolve) => inventories.push(resolve)),
      rescanAgents: () => new Promise<Agents>((resolve) => inventories.push(resolve)),
      daemonOnline: async () => true,
    };
    const transport: ChatTransport = { async startRun() { return { runId: "r" }; }, async reattachRun() {}, async stopRun() {}, async fetchRunStatus() { return "failed"; } };
    const hook = renderHook(() => useAgentFailureSurface({ transport, runtimeAccess, initialMessages: undefined, onSelectionChange, onExecutionModeChange, isAbortError }));
    return { hook, inventories, onSelectionChange, onExecutionModeChange };
  }

  it("records the latest inventory and ignores a slower, older one", async () => {
    const { hook, inventories } = setup();
    let first!: Promise<Agents>;
    let second!: Promise<Agents>;
    act(() => { first = hook.result.current.runtimeAccess.listAgents(); second = hook.result.current.runtimeAccess.rescanAgents(); });
    const fresh = [{ id: "fresh", name: "Fresh", available: true }] as Agents;
    const stale = [{ id: "stale", name: "Stale", available: true }] as Agents;
    await act(async () => { inventories[1]?.(fresh); await second; });
    await act(async () => { inventories[0]?.(stale); await expect(first).resolves.toBe(stale); });
    expect(hook.result.current.actions.agents).toBe(fresh);
    expect(hook.result.current.initialMessages).toBeUndefined();
  });

  it("switches only to an available agent, moving execution to local first", async () => {
    const { hook, inventories, onSelectionChange, onExecutionModeChange } = setup();
    let pending!: Promise<Agents>;
    act(() => { pending = hook.result.current.runtimeAccess.listAgents(); });
    await act(async () => { inventories[0]?.([{ id: "up", name: "Up", available: true }, { id: "down", name: "Down", available: false }] as Agents); await pending; });

    hook.result.current.actions.switchAgent({ agentId: "down" });
    hook.result.current.actions.switchAgent({ agentId: "missing" });
    expect(onSelectionChange).not.toHaveBeenCalled();
    hook.result.current.actions.switchAgent({ agentId: "up" });
    expect(onExecutionModeChange).toHaveBeenCalledWith("local");
    expect(onSelectionChange).toHaveBeenCalledWith({ agentId: "up" });
  });
});

describe("AgentFailureCard", () => {
  const baseProps = { name: "agent_failure", runStreaming: false, runSucceeded: false, runId: "run-1" };

  it("renders nothing when the hook reports no failure", () => {
    const format = vi.fn(formatUserFacingError);
    const { container } = render(<AgentFailureCard {...baseProps} events={[]} useTHook={useTHook} useAgentFailureCardHook={useAgentFailureCard} formatUserFacingError={format} redactionOptions={{}} />);
    expect(container.innerHTML).toBe("");
    expect(format).not.toHaveBeenCalled();
  });

  it("formats a generic failure with the default action and plain step, and offers no switch", () => {
    const format = vi.fn(formatUserFacingError);
    render(<AgentFailureCard {...baseProps} events={[{ reason: GENERIC_AGENT_FAILURE, details: "d" }]} useTHook={useTHook} useAgentFailureCardHook={useAgentFailureCard} formatUserFacingError={format} redactionOptions={{}} />);
    expect(format).toHaveBeenCalledWith({
      message: GENERIC_AGENT_FAILURE,
      action: "«Review the saved work above before sending another message. Copy details and report this problem.»",
      step: "assistant answer", cause: "d",
    }, {});
    expect(screen.getByRole("status").textContent).toContain(GENERIC_AGENT_FAILURE);
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });

  it("uses the hint as the action, names the agent in the step, and switches on click", () => {
    const format = vi.fn(formatUserFacingError);
    const switchAgent = vi.fn();
    render(<AgentFailureCard {...baseProps} events={[geminiFailure]} useTHook={useTHook} useAgentFailureCardHook={useAgentFailureCard} formatUserFacingError={format} redactionOptions={{}} />,
      { wrapper: withSurface({ agents: [{ id: "antigravity", name: "Antigravity", available: true }], switchAgent }) });
    expect(format.mock.calls[0]?.[0]).toMatchObject({ action: `«${GEMINI_INELIGIBLE_HINT.hint}»`, step: "assistant answer (gemini)" });
    fireEvent.click(screen.getByRole("button", { name: "«Switch to Antigravity»" }));
    expect(switchAgent).toHaveBeenCalledWith({ agentId: "antigravity" });
  });
});
