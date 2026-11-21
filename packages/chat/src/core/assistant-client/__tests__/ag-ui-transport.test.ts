import { describe, expect, it, vi } from "vitest";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { createAgUiRunClient, type AgUiClient } from "../ag-ui-transport.js";
import { createAgUiToAgentTranslationState } from "../../ag-ui/event-reduction.js";
import type { ChatMessage } from "../../messages.js";
import type { RunHandlers } from "../../transport.js";

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
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[1]!.observer!.next({ type: EventType.RUN_ERROR, message: "" });
    expect(handlers.onError.mock.calls[0]![0]).toEqual(new Error("AG-UI run failed"));
    agents[1]!.observer!.next({ type: EventType.RUN_ERROR, message: "quota" });
    expect(handlers.onError.mock.calls[1]![0]).toEqual(new Error("quota"));
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
    expect(handlers.onError).toHaveBeenCalledWith(new Error("The agent run stream stopped with an error (Error); send the message again."));
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
  agents[0]!.observer!.complete();
  await started;
});

it.each([undefined, "", 17])("omits an absent or malformed originating tab id (%s)", async frontendTabId => {
  const { client, agents, handlers } = setup();
  const started = client.startAgUiRun({ input: { history, context: { frontendBindToken: "token", frontendTabId }, signal: new AbortController().signal }, handlers });
  expect(agents[0]!.inputs[0]!.forwardedProps).toMatchObject({ frontendBindToken: "token" });
  expect(agents[0]!.inputs[0]!.forwardedProps).not.toHaveProperty("frontendTabId");
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

  it("settles once: a stream that errors after RUN_FINISHED reports the error and does not finish twice", async () => {
    const { client, agents, handlers } = setup();
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "a" });
    agents[0]!.observer!.next({ type: EventType.RUN_FINISHED, threadId: "t", runId: "agui-id1" });
    const failure = new Error("late reset");
    agents[0]!.observer!.error(failure);
    agents[0]!.observer!.complete();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith(new Error("The agent run stream stopped with an error (Error); send the message again."));
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
