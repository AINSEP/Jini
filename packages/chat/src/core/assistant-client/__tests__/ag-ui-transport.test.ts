import { describe, expect, it, vi } from "vitest";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { createAgUiRunClient, type AgUiClient, type AgUiDurableLocalCliBinding, type LocalRunLaunch } from "../ag-ui-transport.js";
import { createAssistantTransportClient } from "../transport.js";
import { notices } from "../../run-events/__tests__/fixture.js";
import { createAgUiToAgentTranslationState } from "../../ag-ui/event-reduction.js";
import type { ChatMessage } from "../../messages.js";
import type { RunHandlers, StartRunInput } from "../../transport.js";

type Observer = { next: (event: unknown) => void; error: (error: unknown) => void; complete: () => void };

/** A hand-written HttpAgent stand-in: records the run input and hands the test its observer. */
function fakeAgent() {
  const abortController = new AbortController();
  const agent = {
    abortController,
    inputs: [] as RunAgentInput[],
    observer: undefined as Observer | undefined,
    abortRun: vi.fn(() => abortController.abort()),
    run(input: RunAgentInput) {
      agent.inputs.push(input);
      return { subscribe: (observer: Observer) => { agent.observer = observer; return {}; } };
    },
  };
  return agent;
}

const NAMES = { usage: "u", status: "s", extensionPrefix: "x." };

function setup() {
  const agents: ReturnType<typeof fakeAgent>[] = [];
  const created: { url: string; threadId: string }[] = [];
  let id = 0;
  const client = createAgUiRunClient({ ports: {
    endpoint: "/api/ag-ui", runIdPrefix: "agui-", customEventNames: NAMES,
    mintId: () => `id${(id += 1)}`,
    createAgent: (input) => { created.push(input); const agent = fakeAgent(); agents.push(agent); return agent as AgUiClient; },
  } });
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() } as unknown as RunHandlers & { onEvent: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> };
  return { client, agents, created, handlers };
}

const REDACTED = { secretRedacted: true } as NonNullable<ChatMessage["secretRedaction"]>;
const history: ChatMessage[] = [
  { id: "u1", role: "user", content: "hi", secretRedaction: REDACTED },
  { id: "a1", role: "assistant", content: "hello" },
  { id: "a2", role: "assistant", content: "   " },
];

describe("createAgUiRunClient", () => {
  it("starts a run on the first event, streams translated events, and settles once on RUN_FINISHED", async () => {
    const { client, agents, created, handlers } = setup();
    const started = client.startAgUiRun({ input: { history, agentId: "agent-7", conversationId: "conv-1", signal: new AbortController().signal }, handlers });
    const agent = agents[0]!;
    expect(created).toEqual([{ url: "/api/ag-ui", threadId: "conv-1" }]);
    expect(agent.inputs[0]).toMatchObject({
      // The daemon owns tool registrations; only the originating tab token crosses this transport.
      threadId: "conv-1", runId: "agui-id1", state: null, tools: [], context: [],
      messages: [{ id: "u1", role: "user", content: "hi" }, { id: "a1", role: "assistant", content: "hello" }],
      forwardedProps: { agentId: "agent-7", secretRedacted: true },
    });
    agent.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "Hi" });
    await expect(started).resolves.toEqual({ runId: "agui-id1" });
    agent.observer!.next({ type: EventType.RUN_FINISHED, threadId: "conv-1", runId: "agui-id1" });
    agent.observer!.complete();
    expect(handlers.onEvent).toHaveBeenCalledWith({ kind: "text", text: "Hi" });
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).toHaveBeenCalledWith([{ kind: "text", text: "Hi" }]);
    expect(client.isAgUiRunId({ runId: "agui-id1" })).toBe(true);
    expect(client.isAgUiRunId({ runId: "run-9" })).toBe(false);
  });

  it("mints a thread for a first turn and sends no optional forwarded props", async () => {
    const { client, agents, created, handlers } = setup();
    const started = client.startAgUiRun({ input: { history: [{ id: "u", role: "user", content: "x" }], signal: new AbortController().signal }, handlers });
    expect(created[0]!.threadId).toBe("id2");
    expect(agents[0]!.inputs[0]!.forwardedProps).toEqual({});
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED });
    agents[0]!.observer!.complete();
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED });
    await expect(started).resolves.toEqual({ runId: "agui-id1" });
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it("treats RUN_ERROR abort as a clean finish and any other RUN_ERROR as a failure", async () => {
    const { client, agents, handlers } = setup();
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.RUN_ERROR, code: "abort", message: "stopped" });
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledWith([]);
    const order: string[] = [];
    handlers.onError.mockImplementation(() => order.push("error"));
    handlers.onDone.mockImplementation(() => order.push("done"));
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[1]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "partial" });
    agents[1]!.observer!.next({ type: EventType.RUN_ERROR, message: "" });
    expect(handlers.onError.mock.calls[0]![0]).toEqual(new Error("AG-UI run failed"));
    agents[1]!.observer!.next({ type: EventType.RUN_ERROR, message: "quota" });
    agents[1]!.observer!.error(new Error("late reset"));
    agents[1]!.observer!.complete();
    expect(order).toEqual(["error", "done"]);
    expect(handlers.onDone).toHaveBeenLastCalledWith([{ kind: "text", text: "partial" }]);
  });

  it("rejects the start when the stream errors before any event, wrapping a non-Error", async () => {
    const { client, agents, handlers } = setup();
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.error("401 unauthorized");
    await expect(started).rejects.toEqual(new Error("The agent run stream stopped with an error (string); send the message again."));
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("rejects the start with the HTTP status and keeps the original error as the cause", async () => {
    const { client, agents, handlers } = setup();
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    const failure = Object.assign(new Error("HTTP 502: upstream refused"), { status: 502 });
    agents[0]!.observer!.error(failure);
    const rejection = await started.then(() => undefined, (error: unknown) => error);
    expect(rejection).toHaveProperty("message", "The agent run stream stopped with an error (HTTP 502, Error); send the message again.");
    expect(rejection).toHaveProperty("cause", failure);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("reports a mid-stream failure and still hands the collected events to onDone", async () => {
    const { client, agents, handlers } = setup();
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "partial" });
    const failure = new Error("socket reset");
    agents[0]!.observer!.error(failure);
    agents[0]!.observer!.error(failure);
    agents[0]!.observer!.complete();
    expect(handlers.onError).toHaveBeenCalledWith(new Error("The agent run stream stopped with an error (Error); send the message again."));
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onError.mock.calls[0]![0]).toHaveProperty("cause", failure);
    expect(handlers.onDone).toHaveBeenCalledWith([{ kind: "text", text: "partial" }]);
  });

  it("stops through the host signal or stopAgUiRun, finishing cleanly when the fetch then rejects", async () => {
    const { client, agents, handlers } = setup();
    const signal = new AbortController();
    void client.startAgUiRun({ input: { history, signal: signal.signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_START, messageId: "m", role: "assistant" });
    signal.abort();
    expect(agents[0]!.abortRun).toHaveBeenCalledTimes(1);
    agents[0]!.observer!.error(new DOMException("aborted", "AbortError"));
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledWith([{ kind: 'status', code: 'step_start', label: '', data: { messageId: 'm' } }]);

    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    await client.stopAgUiRun({ runId: "agui-id3" });
    expect(agents[1]!.abortRun).toHaveBeenCalledTimes(1);
    await client.stopAgUiRun({ runId: "agui-unknown" });
  });

  it("answers reattach and status honestly: there is no server-side run to resume", async () => {
    const { client, handlers } = setup();
    await client.reattachAgUiRun({ handlers });
    expect(handlers.onDone).toHaveBeenCalledWith([]);
    await expect(client.fetchAgUiRunStatus({})).resolves.toBeNull();
  });

  it("exposes the event dispatcher for a caller that drives its own context", () => {
    const { client, handlers } = setup();
    const finish = vi.fn();
    const ctx = { collected: [], handlers, state: createAgUiToAgentTranslationState({ customEventNames: NAMES }), finish };
    client.handleAgUiEvent({ event: { type: EventType.CUSTOM, name: "x.card", value: 1 }, ctx });
    expect(ctx.collected).toEqual([{ kind: "ext", name: "card", data: 1 }]);
    client.handleAgUiEvent({ event: { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" }, ctx });
    expect(finish).toHaveBeenCalledOnce();
  });
});


it("forwards the current originating tab token without client tool definitions", async () => {
  const { client, agents, handlers } = setup();
  const started = client.startAgUiRun({ input: { history, context: { frontendBindToken: "tab-B-current", frontendTabId: "tab-B" }, signal: new AbortController().signal }, handlers });
  expect(agents[0]!.inputs[0]!.forwardedProps).toMatchObject({ frontendBindToken: "tab-B-current", frontendTabId: "tab-B" });
  expect(agents[0]!.inputs[0]!.tools).toEqual([]);
  agents[0]!.observer!.next({ type: EventType.RUN_FINISHED });
  agents[0]!.observer!.complete();
  await started;
});

it.each([undefined, "", 17])("omits an absent or malformed originating tab id (%s)", async frontendTabId => {
  const { client, agents, handlers } = setup();
  const started = client.startAgUiRun({ input: { history, context: { frontendBindToken: "token", frontendTabId }, signal: new AbortController().signal }, handlers });
  expect(agents[0]!.inputs[0]!.forwardedProps).toMatchObject({ frontendBindToken: "token" });
  expect(agents[0]!.inputs[0]!.forwardedProps).not.toHaveProperty("frontendTabId");
  agents[0]!.observer!.next({ type: EventType.RUN_FINISHED });
  agents[0]!.observer!.complete();
  await started;
});

/** Pins for the A3 split: each one names a line the split moves between functions. */
describe("createAgUiRunClient run lifetime", () => {
  it("refuses a run whose signal is already aborted, before the agent runs or is registered", async () => {
    const { client, agents, handlers } = setup();
    const signal = new AbortController();
    signal.abort();
    const failure = await client.startAgUiRun({ input: { history, signal: signal.signal }, handlers }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect((failure as DOMException).name).toBe("AbortError");
    expect((failure as DOMException).message).toBe("Run cancelled");
    expect(agents[0]!.inputs).toEqual([]);
    await client.stopAgUiRun({ runId: "agui-id1" });
    expect(agents[0]!.abortRun).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("forgets a finished run: neither the host signal nor stopAgUiRun reaches its agent afterwards", async () => {
    const { client, agents, handlers } = setup();
    const signal = new AbortController();
    const started = client.startAgUiRun({ input: { history, signal: signal.signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED, threadId: "t", runId: "agui-id1" });
    await expect(started).resolves.toEqual({ runId: "agui-id1" });
    signal.abort();
    await client.stopAgUiRun({ runId: "agui-id1" });
    expect(agents[0]!.abortRun).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it("forgets a run that failed before its first event, without calling onError or onDone", async () => {
    const { client, agents, handlers } = setup();
    const signal = new AbortController();
    const started = client.startAgUiRun({ input: { history, signal: signal.signal }, handlers });
    const failure = new Error("503 unavailable");
    agents[0]!.observer!.error(failure);
    await expect(started).rejects.toEqual(new Error("The agent run stream stopped with an error (Error); send the message again."));
    signal.abort();
    await client.stopAgUiRun({ runId: "agui-id1" });
    expect(agents[0]!.abortRun).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("reports a mid-stream failure before it settles, wraps a non-Error, and forgets the run", async () => {
    const { client, agents, handlers } = setup();
    const signal = new AbortController();
    const order: string[] = [];
    handlers.onError.mockImplementation(() => order.push("error"));
    handlers.onDone.mockImplementation(() => order.push("done"));
    void client.startAgUiRun({ input: { history, signal: signal.signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "partial" });
    agents[0]!.observer!.error("socket reset");
    expect(order).toEqual(["error", "done"]);
    expect(handlers.onError.mock.calls[0]![0]).toEqual(new Error("The agent run stream stopped with an error (string); send the message again."));
    signal.abort();
    await client.stopAgUiRun({ runId: "agui-id1" });
    expect(agents[0]!.abortRun).not.toHaveBeenCalled();
  });

  it("settles once: a stream that errors after RUN_FINISHED ignores the late error", async () => {
    const { client, agents, handlers } = setup();
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "a" });
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED, threadId: "t", runId: "agui-id1" });
    const failure = new Error("late reset");
    agents[0]!.observer!.error(failure);
    agents[0]!.observer!.complete();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).toHaveBeenCalledWith([{ kind: "text", text: "a" }]);
  });

  it("keeps two runs apart: stopping one aborts only its own agent and each keeps its own events", async () => {
    const { client, agents, handlers } = setup();
    const second = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void client.startAgUiRun({ input: { history, conversationId: "c1", signal: new AbortController().signal }, handlers });
    void client.startAgUiRun({ input: { history, conversationId: "c2", signal: new AbortController().signal }, handlers: second as unknown as RunHandlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "one" });
    agents[1]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "two" });
    await client.stopAgUiRun({ runId: "agui-id2" });
    expect(agents[0]!.abortRun).not.toHaveBeenCalled();
    expect(agents[1]!.abortRun).toHaveBeenCalledTimes(1);
    agents[0]!.observer!.complete();
    agents[1]!.observer!.complete();
    expect(handlers.onDone).toHaveBeenCalledWith([{ kind: "text", text: "one" }]);
    expect(second.onDone).toHaveBeenCalledWith([{ kind: "text", text: "two" }]);
  });
});

/** A durable Local CLI binding whose hooks record what the AG-UI client hands them. The host owns
 *  the wire projection and accepted-ID interpretation; these fakes stand in for both. */
function durableSetup(extra: { follow?: AgUiDurableLocalCliBinding["followAcceptedRun"]; onLiveEvent?: ({ event }: { event: unknown }) => boolean } = {}) {
  const order: string[] = [];
  const agents: ReturnType<typeof fakeAgent>[] = [];
  const created: { url: string; threadId: string }[] = [];
  let id = 0;
  const binding = {
    prepareRunInput: vi.fn<AgUiDurableLocalCliBinding["prepareRunInput"]>(({ wire, launch }) => {
      order.push("prepare");
      return { ...wire, forwardedProps: { ...wire.forwardedProps, launch: { contextRef: launch.contextRef, agentId: launch.agentId, messageId: launch.messageId, conversationId: launch.conversationId } } };
    }),
    readAcceptedRun: vi.fn<AgUiDurableLocalCliBinding["readAcceptedRun"]>(({ event }) =>
      event.runId === "run-canon" ? { runId: "run-canon", messageId: "a-1", conversationId: "conv-1" } : undefined),
    followAcceptedRun: vi.fn<AgUiDurableLocalCliBinding["followAcceptedRun"]>((required) => { order.push("follow"); extra.follow?.(required); }),
    cancelAcceptedRun: vi.fn<AgUiDurableLocalCliBinding["cancelAcceptedRun"]>(async () => { order.push("cancel"); }),
    cancelPendingRun: vi.fn<AgUiDurableLocalCliBinding["cancelPendingRun"]>(async () => { order.push("pending-cancel"); }),
  };
  const client = createAgUiRunClient({ ports: {
    endpoint: "/api/ag-ui", runIdPrefix: "agui-", customEventNames: NAMES,
    mintId: () => `id${(id += 1)}`,
    createAgent: (input) => { created.push(input); const agent = fakeAgent(); agents.push(agent); return agent as AgUiClient; },
    durableLocalCli: binding,
    ...(extra.onLiveEvent ? { onLiveEvent: extra.onLiveEvent } : {}),
  } });
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() } as unknown as RunHandlers & { onEvent: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> };
  const bindRun = vi.fn((required: { runId: string; binding: { messageId: string; conversationId: string } }) => { order.push(`bind:${required.runId}`); });
  return { client, agents, created, handlers, binding, order, bindRun };
}

const LAUNCH: LocalRunLaunch = { contextRef: { prompt: "hi", assistantMessageId: "a-1", conversationId: "conv-1" }, agentId: "agent-7", messageId: "a-1", conversationId: "conv-1" };
const flushAll = () => new Promise(resolve => setTimeout(resolve, 0));

describe("durable AG-UI Local CLI binding", () => {
  it.each([undefined, "a-1"])("keeps delivery-only starts after an explicit segment acknowledgment (%s)", async (messageId) => {
    const { client, agents, handlers, binding, bindRun } = durableSetup();
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers, durable: { launch: { ...LAUNCH, messageId }, bindRun } });
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "agui-id1" });
    await expect(started).resolves.toEqual({ runId: "agui-id1" });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "legacy" });
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED });
    expect(binding.followAcceptedRun).not.toHaveBeenCalled();
    expect(bindRun).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([{ kind: "text", text: "legacy" }]);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("rejects a RUN_ERROR before start without stream callbacks", async () => {
    const { client, agents, handlers } = setup();
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.RUN_ERROR, message: "refused" });
    agents[0]!.observer!.complete();
    await expect(started).rejects.toThrow("refused");
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("an AG-UI stream ending without a terminal verdict is not success", async () => {
    const { client, agents, handlers } = setup();
    const order: string[] = [];
    handlers.onError.mockImplementation(() => order.push("error"));
    handlers.onDone.mockImplementation(() => order.push("done"));
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "partial" });
    await started;
    agents[0]!.observer!.complete();
    expect(order).toEqual(["error", "done"]);
    expect(handlers.onError.mock.calls[0]![0].message).toMatch(/stream.*(ended|stopped|interrupt)/i);
    expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([{ kind: "text", text: "partial" }]);
    const durable = durableSetup();
    const pending = durable.client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers: durable.handlers, durable: { launch: LAUNCH, bindRun: durable.bindRun } });
    durable.agents[0]!.observer!.complete();
    await expect(pending).rejects.toThrow();
    expect(durable.bindRun).not.toHaveBeenCalled();
    expect(durable.binding.followAcceptedRun).not.toHaveBeenCalled();
    expect(durable.handlers.onError).not.toHaveBeenCalled();
    expect(durable.handlers.onDone).not.toHaveBeenCalled();
  });

  it("an accepted interrupt reaches the live observer without replaying the transcript", async () => {
    const live = vi.fn(() => false);
    const { client, agents, handlers, binding, bindRun } = durableSetup({ onLiveEvent: live });
    const started = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers, durable: { launch: LAUNCH, bindRun } });
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "run-canon" });
    await started;
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "segment" });
    const interrupt = { type: EventType.RUN_FINISHED, threadId: "conv-1", runId: "run-canon", outcome: { type: "interrupt", interrupts: [{ id: "pause", reason: "confirmation", metadata: { exchangeId: "exchange" } }] } };
    agents[0]!.observer!.next(interrupt);
    agents[0]!.observer!.error(new Error("segment lost"));
    agents[0]!.observer!.complete();
    expect(live).toHaveBeenCalledWith({ event: interrupt });
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    binding.followAcceptedRun.mock.calls[0]![0].handlers.onDone([{ kind: "text", text: "canonical" }]);
    expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([{ kind: "text", text: "canonical" }]);
    expect(client.isAcceptedAgUiRun?.({ runId: "run-canon" })).toBe(false);
  });

  it("releases a detached accepted run without affecting another live follower", async () => {
    const { client, agents, handlers, binding, bindRun } = durableSetup();
    const detach = new AbortController();
    const first = client.startAgUiRun({ input: { history, signal: detach.signal }, handlers, durable: { launch: LAUNCH, bindRun } });
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "run-canon" });
    await first;
    binding.readAcceptedRun.mockImplementation(({ event }) => ({ runId: event.runId, messageId: "a-2", conversationId: "conv-2" }));
    const second = client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers, durable: { launch: LAUNCH, bindRun } });
    agents[1]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-2", runId: "run-other" });
    await second;
    agents[0]!.observer!.complete();
    // Unload/detach aborts the delivery segment only. It is not Stop.
    detach.abort();
    expect(client.isAcceptedAgUiRun?.({ runId: "run-canon" })).toBe(false);
    expect(client.isAcceptedAgUiRun?.({ runId: "run-other" })).toBe(true);
    expect(binding.cancelAcceptedRun).not.toHaveBeenCalled();
    binding.followAcceptedRun.mock.calls[1]![0].handlers.onDone([]);
    expect(client.isAcceptedAgUiRun?.({ runId: "run-other" })).toBe(false);
  });

  it("AG-UI detach closes only the reader and explicit Stop cancels the canonical run once", async () => {
    const { client, agents, handlers, binding, bindRun, order } = durableSetup();
    const detach = new AbortController();
    const stop = new AbortController();
    const started = client.startAgUiRun({ input: { history, conversationId: "conv-1", signal: detach.signal, cancelSignal: stop.signal }, handlers, durable: { launch: LAUNCH, bindRun } });
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "run-canon" });
    // The canonical accepted ID reaches ChatTransport; the client segment ID stays on the wire.
    await expect(started).resolves.toEqual({ runId: "run-canon" });
    expect(agents[0]!.inputs[0]!.runId).toBe("agui-id1");
    expect(order).toEqual(["prepare", "bind:run-canon", "follow"]);
    expect(binding.followAcceptedRun.mock.calls[0]![0]).toMatchObject({ runId: "run-canon", messageId: "a-1", conversationId: "conv-1", signal: detach.signal });
    agents[0]!.observer!.complete();
    // Explicit Stop, through the cancel signal, detach and ChatTransport.stopRun, cancels once.
    let finishCancel!: () => void;
    binding.cancelAcceptedRun.mockImplementation(() => new Promise<void>(resolve => { finishCancel = resolve; }));
    stop.abort();
    detach.abort();
    expect(agents[0]!.abortRun).toHaveBeenCalledTimes(1);
    const stopping = client.stopAgUiRun({ runId: "run-canon" });
    expect(client.isAcceptedAgUiRun?.({ runId: "run-canon" })).toBe(true);
    finishCancel();
    await stopping;
    expect(binding.cancelAcceptedRun).toHaveBeenCalledTimes(1);
    stop.abort();
    expect(binding.cancelAcceptedRun).toHaveBeenCalledTimes(1);
    expect(binding.cancelAcceptedRun).toHaveBeenCalledWith({ runId: "run-canon", messageId: "a-1", conversationId: "conv-1" }, {});
    expect(client.isAcceptedAgUiRun?.({ runId: "run-canon" })).toBe(false);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it.each([false, true])("a Stop before acceptance shares the pending result, falling back only on refusal (%s)", async (refused) => {
    const { client, agents, created, handlers, binding, bindRun } = durableSetup();
    if (refused) binding.cancelPendingRun.mockRejectedValue(new Error("refused"));
    const stop = new AbortController();
    const detach = new AbortController();
    const started = client.startAgUiRun({ input: { history, conversationId: "conv-1", signal: detach.signal, cancelSignal: stop.signal }, handlers, durable: { launch: LAUNCH, bindRun } });
    stop.abort();
    stop.signal.dispatchEvent(new Event("abort"));
    detach.abort();
    expect(binding.cancelAcceptedRun).not.toHaveBeenCalled();
    expect(binding.cancelPendingRun).toHaveBeenCalledExactlyOnceWith({ messageId: "a-1", conversationId: "conv-1" }, {});
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "run-canon" });
    await expect(started).resolves.toEqual({ runId: "run-canon" });
    // The orphaned-generation stopRun that follows does not cancel a second time.
    await client.stopAgUiRun({ runId: "run-canon" });
    expect(binding.cancelAcceptedRun).toHaveBeenCalledTimes(refused ? 1 : 0);
    expect(client.isAcceptedAgUiRun?.({ runId: "run-canon" })).toBe(false);
    expect(created).toHaveLength(1);
    expect(agents[0]!.inputs).toHaveLength(1);
    expect(binding.prepareRunInput).toHaveBeenCalledTimes(1);
  });

  it("a durable AG-UI start retains Local CLI launch and attachment context", async () => {
    const { client: agUi, agents, binding, order } = durableSetup();
    const bound: unknown[] = [];
    const transport = createAssistantTransportClient({ ports: {
      runsUrl: "/runs", byokTurnUrl: "/byok", byokRunIdPrefix: "byok:", notices,
      mintId: () => "minted",
      fetch: async () => { throw new Error("fetch is not used on the durable AG-UI start"); },
      projectPrompt: ({ prompt }) => prompt,
      // The display projection must never become launch context.
      projectInput: ({ input }) => ({ ...input, history: input.history.map(message => ({ ...message, content: "DISPLAY-ONLY" })) }),
      bindRun: (required) => { order.push(`bind:${required.runId}`); bound.push(required); },
      runBinding: () => undefined,
      followRun: () => { throw new Error("the AG-UI binding follows the accepted run"); },
      acceptRun: async () => { throw new Error("a durable AG-UI start must not launch a second Local CLI run"); },
      agUi,
    } }, {}).createAssistantTransport({ options: {
      getAgUiEnabled: () => true,
      persistUserTurn: async ({ message }) => { order.push(`persist:${message.id}`); },
    } }, {});
    const attachment = { path: "uploads/a.png", name: "a.png" } as unknown as NonNullable<StartRunInput["attachments"]>[number];
    const started = transport.startRun({
      assistantMessageId: "a-1", agentId: "agent-7", attachments: [attachment],
      history: [{ id: "u1", role: "user", content: "describe the image" }],
      context: { conversationId: "conv-1", sessionId: "browser-chosen" }, signal: new AbortController().signal,
    }, { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
    await flushAll();
    expect(order).toEqual(["persist:u1", "prepare"]);
    const launch = binding.prepareRunInput.mock.calls[0]![0].launch;
    expect(launch).toMatchObject({ agentId: "agent-7", messageId: "a-1", conversationId: "conv-1" });
    expect(launch.contextRef).toMatchObject({
      prompt: expect.stringContaining("describe the image"), assistantMessageId: "a-1",
      attachmentIds: ["uploads/a.png"], conversationId: "conv-1",
      userMessage: { id: "u1", role: "user", content: "describe the image" },
    });
    expect(JSON.stringify(launch)).not.toContain("DISPLAY-ONLY");
    expect(launch.contextRef).not.toHaveProperty("sessionId");
    agents[0]!.observer!.next({ type: EventType.RUN_STARTED, threadId: "conv-1", runId: "run-canon" });
    await expect(started).resolves.toEqual({ runId: "run-canon" });
    expect(order).toEqual(["persist:u1", "prepare", "bind:run-canon", "follow"]);
    expect(bound).toEqual([{ runId: "run-canon", binding: { messageId: "a-1", conversationId: "conv-1" } }]);
  });
});
