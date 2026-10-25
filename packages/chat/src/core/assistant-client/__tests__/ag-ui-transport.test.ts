import { describe, expect, it, vi } from "vitest";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { createAgUiRunClient, type AgUiClient } from "../ag-ui-transport.js";
import { createAgUiToAgentTranslationState } from "../../ag-ui/entry.js";
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
    await expect(started).rejects.toEqual(new Error("401 unauthorized"));
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("reports a mid-stream failure and still hands the collected events to onDone", async () => {
    const { client, agents, handlers } = setup();
    void client.startAgUiRun({ input: { history, signal: new AbortController().signal }, handlers });
    agents[0]!.observer!.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "partial" });
    const failure = new Error("socket reset");
    agents[0]!.observer!.error(failure);
    expect(handlers.onError).toHaveBeenCalledWith(failure);
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
