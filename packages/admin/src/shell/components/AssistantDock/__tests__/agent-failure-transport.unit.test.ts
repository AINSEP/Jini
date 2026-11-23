import { expect, it } from "vitest";
import type { AgentEvent, ChatMessage, ChatTransport, RunHandlers } from "../../../../react/kit.js";
import fixture from "./fixtures/gemini-position-9.js";
import { AGENT_FAILURE_EVENT, GENERIC_AGENT_FAILURE, withAgentFailureSurface } from "../agent-failure.js";

function harness() {
  let handlers: RunHandlers | undefined;
  const transport: ChatTransport = {
    async startRun(_input, next) { handlers = next; return { runId: "run" }; },
    async reattachRun(_id, next) { handlers = next; },
    async stopRun() {}, async fetchRunStatus() { return "failed"; },
  };
  const seen: AgentEvent[] = [];
  const checkpoints: ChatMessage[] = [];
  const errors: string[] = [];
  const completed: AgentEvent[][] = [];
  const sink: RunHandlers = { onEvent: event => seen.push(event), onError: error => errors.push(error.message),
    onDone: events => completed.push(events), onToolInputDelta() {}, onCheckpoint: message => checkpoints.push(message) };
  return { transport: withAgentFailureSurface({ transport }, {}), seen, checkpoints, errors, completed, sink,
    emit: () => { if (!handlers) throw new Error("not connected"); return handlers; } };
}

it("projects live failed checkpoints and completion through the existing transport port", async () => {
  const h = harness();
  await h.transport.startRun({ history: [{ id: "user", role: "user", content: "hello" }], agentId: "gemini", signal: new AbortController().signal }, h.sink);
  const message: ChatMessage = { id: "nine", role: "assistant", content: "", agentId: "gemini", runStatus: "failed", events: fixture as AgentEvent[] };
  h.emit().onCheckpoint?.(message);
  h.emit().onDone(message.events ?? []);
  expect(h.checkpoints[0]?.events?.at(-1)?.kind).toBe("ext");
  expect(h.completed[0]?.at(-1)).toEqual(h.checkpoints[0]?.events?.at(-1));
  expect(h.errors).toEqual([]);
});

it("preserves checkpoint support on reattach and redacts the rendered checkpoint", async () => {
  const h = harness();
  await h.transport.reattachRun("run", h.sink);
  h.emit().onCheckpoint?.({ id: "message", role: "assistant", content: "", agentId: "other", runStatus: "failed",
    events: [{ kind: "raw", line: "Error: rejected sk-secret" }] });
  expect(h.checkpoints[0]?.events).toEqual([
    { kind: "raw", line: "Error: rejected [REDACTED]" },
    { kind: "ext", name: AGENT_FAILURE_EVENT, data: { reason: "Error: rejected [REDACTED]", details: "Error: rejected [REDACTED]", agentId: "other" } },
  ]);
});

it("supports non-checkpoint errors without losing stderr or completion", async () => {
  const h = harness();
  const { onCheckpoint: _checkpoint, ...sink } = h.sink;
  await h.transport.startRun({ history: [], agentId: "other", signal: new AbortController().signal }, sink);
  h.emit().onEvent({ kind: "raw", line: "Error: invalid token AQ.secret" });
  h.emit().onError(new Error(GENERIC_AGENT_FAILURE));
  h.emit().onDone([]);
  expect(h.seen[0]).toEqual({ kind: "raw", line: "Error: invalid token [REDACTED]" });
  expect(h.errors).toEqual(["The assistant could not continue this answer. Saved work is above."]);
  expect(h.completed[0]?.at(-1)).toEqual({ kind: "ext", name: AGENT_FAILURE_EVENT, data: {
    reason: "Error: invalid token [REDACTED]", details: "Error: invalid token [REDACTED]", agentId: "other" } });
});

it("retains a structured error when the completion only carries a generic status", async () => {
  const h = harness();
  await h.transport.startRun({ history: [], signal: new AbortController().signal }, h.sink);
  h.emit().onError(new Error("Error: API key not valid."));
  h.emit().onDone([{ kind: "status", label: GENERIC_AGENT_FAILURE }]);
  expect(h.completed[0]?.at(-1)).toEqual({ kind: "ext", name: AGENT_FAILURE_EVENT, data: {
    reason: "Error: API key not valid.", details: "Error: API key not valid." } });
});

it("redacts refused starts before the handlers render them, and keeps the turn by resolving with no run", async () => {
  const h = harness();
  const transport = withAgentFailureSurface({ transport: { ...h.transport,
    async startRun() { throw new Error("Error: rejected Bearer opaque-secret"); } } }, {});
  await expect(transport.startRun({ history: [], signal: new AbortController().signal }, h.sink)).resolves.toEqual({ runId: "" });
  expect(h.errors).toEqual(["Error: rejected Bearer [REDACTED]"]);
  expect(h.seen).toEqual([{ kind: "ext", name: AGENT_FAILURE_EVENT, data: {
    reason: "Error: rejected Bearer [REDACTED]", details: "Error: rejected Bearer [REDACTED]" } }]);
});

it.each([new Error("Error: password=secret"), "Error: password=secret"])("redacts rejected reattachments for the caller and event sink: %s", async failure => {
  const h = harness();
  const transport = withAgentFailureSurface({ transport: { ...h.transport, async reattachRun() { throw failure; } } });
  await expect(transport.reattachRun("run", h.sink)).rejects.toThrow("Error: password=[REDACTED]");
  expect(h.errors).toEqual(["Error: password=[REDACTED]"]);
  expect(h.seen).toEqual([{ kind: "ext", name: AGENT_FAILURE_EVENT, data: {
    reason: "Error: password=[REDACTED]", details: "Error: password=[REDACTED]",
  } }]);
});

it("redacts a rejected non-Error start", async () => {
  const h = harness();
  const transport = withAgentFailureSurface({ transport: { ...h.transport, async startRun() { throw "Error: token=secret"; } } });
  await expect(transport.startRun({ history: [], signal: new AbortController().signal }, h.sink)).resolves.toEqual({ runId: "" });
  expect(h.errors).toEqual(["Error: token=[REDACTED]"]);
});

const stopped = () => { const controller = new AbortController(); controller.abort(); return controller.signal; };
it.each([
  { name: "an AbortError", failure: new DOMException("The queued turn was stopped.", "AbortError"), input: { signal: new AbortController().signal } },
  { name: "a cancelled start", failure: new Error("Error: token=secret"), input: { signal: new AbortController().signal, cancelSignal: stopped() } },
  { name: "a detached start", failure: new Error("Error: token=secret"), input: { signal: stopped(), cancelSignal: new AbortController().signal } },
])("a start the operator stopped still rejects, redacted: $name", async ({ failure, input }) => {
  const h = harness();
  const transport = withAgentFailureSurface({ transport: { ...h.transport, async startRun() { throw failure; } } });
  await expect(transport.startRun({ history: [], ...input }, h.sink)).rejects.toThrow(failure instanceof DOMException ? failure.message : "Error: token=[REDACTED]");
  expect(h.errors).toHaveLength(1);
});

it("keeps the selected agent through an eventless checkpoint and does not duplicate a final error", async () => {
  const h = harness();
  await h.transport.startRun({ history: [], agentId: "chosen", signal: new AbortController().signal }, h.sink);
  h.emit().onCheckpoint?.({ id: "checkpoint", role: "assistant", content: "", runStatus: "running" });
  expect(h.checkpoints[0]).toMatchObject({ agentId: "chosen", events: [] });
  h.emit().onEvent({ kind: "status", label: "Working", detail: "token=secret" });
  expect(h.seen).toEqual([{ kind: "status", label: "Working", detail: "token=[REDACTED]" }]);
  h.emit().onError(new Error("Error: denied"));
  h.emit().onDone([{ kind: "raw", line: "Context" }, { kind: "status", label: "Error: denied" }]);
  expect(h.completed[0]).toEqual([
    { kind: "raw", line: "Context" }, { kind: "status", label: "Error: denied" },
    { kind: "ext", name: AGENT_FAILURE_EVENT, data: { reason: "Error: denied", details: "Context\nError: denied", agentId: "chosen" } },
  ]);
});

it("keeps a generic failure when the transport error contains no meaningful output", async () => {
  const h = harness();
  await h.transport.reattachRun("run", h.sink);
  h.emit().onError(new Error(""));
  h.emit().onDone([]);
  expect(h.seen).toEqual([]);
  expect(h.errors).toEqual([""]);
  expect(h.completed[0]?.at(-1)).toEqual({ kind: "ext", name: AGENT_FAILURE_EVENT, data: {
    reason: GENERIC_AGENT_FAILURE, details: "The assistant stopped without reporting a cause." } });
});

it("completes successful runs using the authoritative final events without a failure card", async () => {
  const h = harness();
  await h.transport.startRun({ history: [], signal: new AbortController().signal }, h.sink);
  h.emit().onEvent({ kind: "raw", line: "Earlier partial output" });
  const progress: AgentEvent = { kind: "ext", name: "progress", data: { complete: true } };
  h.emit().onDone([progress, { kind: "status", label: "Complete" }]);
  expect(h.completed).toEqual([[progress, { kind: "status", label: "Complete" }]]);
  expect(h.errors).toEqual([]);
});

it("projects a failed checkpoint without an agent id when neither the run nor the checkpoint names one", async () => {
  const h = harness();
  await h.transport.reattachRun("run", h.sink);
  h.emit().onCheckpoint?.({ id: "message", role: "assistant", content: "", runStatus: "failed",
    events: [{ kind: "raw", line: "Error: denied" }] });
  expect(h.checkpoints[0]).toEqual({ id: "message", role: "assistant", content: "", runStatus: "failed", events: [
    { kind: "raw", line: "Error: denied" },
    { kind: "ext", name: AGENT_FAILURE_EVENT, data: { reason: "Error: denied", details: "Error: denied" } },
  ] });
});
