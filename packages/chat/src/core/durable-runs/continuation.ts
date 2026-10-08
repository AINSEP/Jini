import type { AgentEvent } from "../index.js";
import type { AcceptedRunRequest, DurableRun } from "./ports.js";

export const CONTINUATION_DIVIDER = "\n\n---\n\nContinued\n\n";
export const UNKNOWN_MUTATION_ERROR = "This operation may already be done. Its earlier outcome is unknown; verify the current state before repeating it.";

/** Object-key order and a new tool-use id must not turn the same mutation into a new operation. */
export function canonicalToolInput({ value }: { value: unknown }, _optional = {}): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalToolInput({ value: item }, {})).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalToolInput({ value: object[key] }, {})}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function delegatedCall(event: Extract<AgentEvent, { kind: "tool_use" }>): { toolId: string; input: unknown } {
  const input = event.input as { toolId?: unknown; input?: unknown } | null;
  if (input && typeof input.toolId === "string" && /execute.*delegated_tool/.test(event.name)) return { toolId: input.toolId, input: input.input };
  return { toolId: event.name, input: event.input };
}

export function hasUnknownToolCall(
  { events, toolId, input }: { events: readonly AgentEvent[]; toolId: string; input: unknown }, _optional = {},
): boolean {
  const completed = new Set(events.filter((event) => event.kind === "tool_result").map((event) => event.toolUseId));
  const canonical = canonicalToolInput({ value: input }, {});
  return events.some((event) => {
    if (event.kind !== "tool_use" || completed.has(event.id)) return false;
    const call = delegatedCall(event);
    return call.toolId === toolId && canonicalToolInput({ value: call.input }, {}) === canonical;
  });
}

function toolHistory(events: readonly AgentEvent[]): string {
  const results = new Map(events.filter((event) => event.kind === "tool_result").map((event) => [event.toolUseId, event]));
  return events.filter((event) => event.kind === "tool_use").map((event) => {
    const result = results.get(event.id);
    return JSON.stringify({ call: delegatedCall(event), result: result ?? "OUTCOME UNKNOWN: verify state before repeating" });
  }).join("\n");
}

export function continuationRequest(
  { run, native }: { run: DurableRun; native: boolean }, _optional = {},
): AcceptedRunRequest {
  const original = JSON.parse(run.request.contextRef) as Record<string, unknown>;
  // Native sessions may have disappeared on deploy. Reconstruction includes the saved answer
  // and tool results for every runtime; completed side effects must never be silently repeated.
  const transcript = run.transcript.map((message) => `${message.role}: ${message.content}`).join("\n\n");
  const prompt = [
    "Continue the interrupted answer from the saved work below. Preserve completed work. Do not repeat completed mutations.",
    "Calls without a result have an unknown outcome: inspect current state before any retry. Expired plans or approvals must be re-planned and re-approved; never reuse them.",
    "A pending question may be asked again when its process was lost. The interrupted segment remains visible; append the continuation.",
    `Accepted task:\n${String(original.prompt ?? "")}`,
    native ? "Native session is confirmed; continue its saved task." : `Saved conversation:\n${transcript}`,
    `Saved partial answer:\n${run.message.content}`,
    `Saved tool calls and results:\n${toolHistory(run.message.events ?? [])}`,
  ].join("\n\n");
  return {
    ...run.request,
    contextRef: JSON.stringify({ ...original, prompt, conversationId: run.conversationId,
      assistantMessageId: run.messageId, principalId: run.principalId,
      recoveryMode: native ? "native" : "reconstruction", recoverySessionId: native ? run.sessionId : undefined,
      // Old attachment claims have been consumed. Saved transcript/tool results carry their
      // observations; attempting to claim the same ids again would fail before execution.
      attachmentIds: [],
    }),
  };
}
