// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import type { ChatMessage, ChatTransport, FrontendSessionBridge, RunHandlers, StartRunInput } from "../../../../../react/kit.js";
import { publishAssistantDockState, resetAssistantDockBus } from "../../../../lib/assistant-dock-bus.js";
import type { prepareAssistantPageBinding } from "../../../../lib/assistant-daemon-activation.js";
import { useAssistantTransport, useAssistantTransportSeam, useLocalCliDaemonPrewarm, type AssistantTransportFactoryOptions, type AssistantTransportInput } from "../assistant-transport.hooks.js";

afterEach(() => { cleanup(); resetAssistantDockBus(); vi.useRealTimers(); });

const local: ExecutionConfig = {
  mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", model: "", baseUrl: "" },
  localCli: { agentId: "ledger-cli" },
};
const byok: ExecutionConfig = { ...local, mode: "byok" };
const run = (): StartRunInput => ({
  history: [{ id: "user-turn", role: "user", content: "Summarize the report" }],
  agentId: "old-cli", context: { model: "old-model", reasoning: "old-effort", frontendBindToken: "old-token", workspace: "docs" },
  signal: new AbortController().signal,
});
function ports() {
  const startRun = vi.fn<ChatTransport["startRun"]>(async () => ({ runId: "run-42" }));
  const transport: ChatTransport = { startRun, reattachRun: async () => {}, stopRun: async () => {}, fetchRunStatus: async () => null };
  const createTransport = vi.fn((_options: AssistantTransportFactoryOptions) => transport);
  const options = { createTransport, getAgUiEnabled: () => false, getResumeCapableAgentIds: () => new Set(["resume-cli"]),
    selectedLocalCliReasoning: vi.fn((_config: ExecutionConfig) => "ledger-effort"),
    localCliSelectionFromConfig: vi.fn(() => ({ agentId: "ledger-cli" })) };
  const handlers: RunHandlers = { onDone: vi.fn(), onError: vi.fn(), onEvent: vi.fn() };
  return { startRun, options, handlers };
}
function pageBridge() {
  let token: string | undefined;
  const bridge: FrontendSessionBridge = {
    bridgeAccess: { subscribe: () => () => {}, respondSuccess: async () => {}, respondError: async () => {} },
    ready: Promise.resolve({ sessionId: "page", bindToken: "token-1" }),
    rebind: async () => ({ sessionId: "page", bindToken: "token-1" }),
    bindToken: () => token, close: () => {},
  };
  return { bridge, attach: (next: string) => { token = next; } };
}

it("keeps the transport stable, awaits the dispatch-time CLI pick, and uses the token from the attached page", async () => {
  const { startRun, options, handlers } = ports();
  const page = pageBridge();
  const ref = { current: byok };
  const ensureConversationId = vi.fn(async () => "conversation-42");
  const persistUserTurn = vi.fn(async (_id: string, _message: ChatMessage) => {});
  const prepareBinding: typeof prepareAssistantPageBinding = async ({ bridge }, metadata) => {
    expect(bridge).toBe(page.bridge);
    metadata?.onActivationSettled?.();
    page.attach("current-token");
    return "not-the-current-token";
  };
  const readExecutionConfigForSend = vi.fn(async () => { ref.current = local; return local; });
  const oldSelection = vi.fn(() => ({ agentId: "outdated" }));
  const pick = vi.fn(() => ({ agentId: "current-cli", model: "new-model", reasoning: "deep" }));
  const { result, rerender } = renderHook(({ readLocalCliSelectionForSend }: Pick<AssistantTransportInput, "readLocalCliSelectionForSend">) => useAssistantTransport({
    executionConfigRef: ref, agentBridge: page.bridge, readExecutionConfigForSend,
    readLocalCliSelectionForSend, ensureConversationId, persistUserTurn,
  }, { ...options, prepareBinding }), { initialProps: { readLocalCliSelectionForSend: oldSelection } });
  const initial = result.current;
  rerender({ readLocalCliSelectionForSend: pick });
  expect(result.current).toBe(initial);
  expect(options.createTransport).toHaveBeenCalledOnce();
  const factory = options.createTransport.mock.calls[0]![0];
  expect(factory.getExecutionConfig()).toBe(byok);
  expect(factory.ensureConversationId).toBe(ensureConversationId);
  expect(factory.persistUserTurn).toBe(persistUserTurn);
  expect(factory.getAgUiEnabled).toBe(options.getAgUiEnabled);
  expect(factory.getResumeCapableAgentIds).toBe(options.getResumeCapableAgentIds);
  const input = run();
  await expect(result.current.startRun(input, handlers)).resolves.toEqual({ runId: "run-42" });
  expect(factory.getExecutionConfig()).toBe(local);
  expect(readExecutionConfigForSend).toHaveBeenCalledOnce();
  expect(pick).toHaveBeenCalledExactlyOnceWith(local);
  expect(oldSelection).not.toHaveBeenCalled();
  expect(startRun.mock.calls).toEqual([[{ ...input, agentId: "current-cli", context: {
    workspace: "docs", model: "new-model", reasoning: "deep", frontendBindToken: "current-token",
  } }, handlers]]);
  expect(options.selectedLocalCliReasoning).not.toHaveBeenCalled();
});

it("falls back to ledger CLI reasoning and forwards the send when activation fails without a page bridge", async () => {
  const { startRun, options, handlers } = ports();
  const { result } = renderHook(() => useAssistantTransport({
    executionConfigRef: { current: local }, readExecutionConfigForSend: async () => local,
  }, { ...options, prepareBinding: async () => { throw new Error("Daemon still starting"); } }));
  const input = { ...run(), context: { model: "obsolete", reasoning: "obsolete", workspace: "docs" } };
  await expect(result.current.startRun(input, handlers)).resolves.toEqual({ runId: "run-42" });
  expect(options.localCliSelectionFromConfig).toHaveBeenCalledExactlyOnceWith({ config: local });
  expect(options.selectedLocalCliReasoning).toHaveBeenCalledExactlyOnceWith(local);
  expect(startRun.mock.calls).toEqual([[{ ...input, agentId: "ledger-cli", context: { workspace: "docs", reasoning: "ledger-effort" } }, handlers]]);
});

it("sends BYOK as frozen by the pane without waking local CLI or rewriting its model", async () => {
  const { startRun, options, handlers } = ports();
  const prepareBinding = vi.fn(async () => "unused");
  const readExecutionConfigForSend = vi.fn(async () => byok);
  const { result } = renderHook(() => useAssistantTransport({
    executionConfigRef: { current: byok }, readExecutionConfigForSend,
  }, { ...options, prepareBinding }));
  const input = run();
  await expect(result.current.startRun(input, handlers)).resolves.toEqual({ runId: "run-42" });
  expect(readExecutionConfigForSend).toHaveBeenCalledOnce();
  expect(prepareBinding).not.toHaveBeenCalled();
  expect(startRun.mock.calls).toEqual([[input, handlers]]);
});

it("reports slow activation after 500 ms and clears it at activation settlement, before page attach completes", async () => {
  vi.useFakeTimers();
  const { startRun, options, handlers } = ports();
  const executionConfigRef = { current: local };
  const page = pageBridge();
  let activationSettled: (() => void) | undefined;
  let complete!: (value: string) => void;
  const prepareBinding: typeof prepareAssistantPageBinding = (_input, metadata) => {
    activationSettled = metadata?.onActivationSettled;
    return new Promise(resolve => { complete = resolve; });
  };
  const { result } = renderHook(() => useAssistantTransportSeam({ executionConfigRef, agentBridge: page.bridge }, {
    useTransport: input => useAssistantTransport(input, { ...options, prepareBinding }),
  }));
  const initialTransport = result.current.transport;
  const pending = initialTransport.startRun(run(), handlers);
  act(() => { vi.advanceTimersByTime(499); });
  expect(result.current.daemonStarting).toBe(false);
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current.daemonStarting).toBe(true);
  act(() => activationSettled?.());
  expect(result.current.daemonStarting).toBe(false);
  expect(startRun).not.toHaveBeenCalled();
  expect(result.current.transport).toBe(initialTransport);
  page.attach("delayed-token");
  complete("delayed-token");
  await expect(pending).resolves.toEqual({ runId: "run-42" });
  expect(vi.getTimerCount()).toBe(0);
});

it("does not dispatch when Stop arrives during binding, or when a required page has no token", async () => {
  vi.useFakeTimers();
  const { startRun, options, handlers } = ports();
  const { bridge } = pageBridge();
  let settle!: (value: undefined) => void;
  const first = new Promise<undefined>(resolve => { settle = resolve; });
  const prepareBinding = vi.fn<typeof prepareAssistantPageBinding>().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const onDaemonStartingChange = vi.fn();
  const { result } = renderHook(() => useAssistantTransport({
    executionConfigRef: { current: local }, agentBridge: bridge, onDaemonStartingChange,
  }, { ...options, prepareBinding }));
  const cancel = new AbortController();
  const pending = result.current.startRun({ ...run(), cancelSignal: cancel.signal }, handlers);
  vi.advanceTimersByTime(500);
  const reason = new DOMException("Stopped during startup", "AbortError");
  cancel.abort(reason);
  expect(onDaemonStartingChange.mock.calls).toEqual([[{ starting: true }], [{ starting: false }]]);
  settle(undefined);
  await expect(pending).rejects.toBe(reason);
  expect(onDaemonStartingChange).toHaveBeenCalledTimes(2);
  await expect(result.current.startRun(run(), handlers)).rejects.toThrow("the assistant page is not attached");
  expect(startRun).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("prewarms only after the open dock loads local config and aborts the wake on close before allowing a retry", async () => {
  const requests: AbortSignal[] = [];
  let rejectFirst!: (error: unknown) => void;
  const activate = vi.fn<typeof import("../../../../lib/assistant-daemon-activation.js").activateAssistantDaemon>()
    .mockImplementationOnce(({ signal } = {}) => {
      if (!signal) throw new Error("Expected cancellable wake");
      requests.push(signal);
      return new Promise((_resolve, reject) => { rejectFirst = reject; });
    })
    .mockRejectedValueOnce(new Error("Service offline"))
    .mockResolvedValueOnce(undefined);
  const { result, rerender } = renderHook((props: { mode: ExecutionConfig["mode"]; configLoaded: boolean }) =>
    useLocalCliDaemonPrewarm(props, { activate }), { initialProps: { mode: "local-cli", configLoaded: false } });
  act(() => publishAssistantDockState({ open: true }));
  expect(activate).not.toHaveBeenCalled();
  rerender({ mode: "byok", configLoaded: true });
  expect(activate).not.toHaveBeenCalled();
  rerender({ mode: "local-cli", configLoaded: true });
  expect(requests[0]?.aborted).toBe(false);
  act(() => publishAssistantDockState({ open: false }));
  expect(requests[0]?.aborted).toBe(true);
  await act(async () => { rejectFirst(new Error("Cancelled read")); });
  expect(result.current).toBeNull();
  await act(async () => publishAssistantDockState({ open: true }));
  expect(result.current).toBe("Service offline");
  act(() => publishAssistantDockState({ open: false }));
  await act(async () => publishAssistantDockState({ open: true }));
  expect(result.current).toBeNull();
  expect(activate).toHaveBeenCalledTimes(3);
});
