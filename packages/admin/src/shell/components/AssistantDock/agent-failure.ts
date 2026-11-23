/** Compatibility copy of the proposed @jini-ai/chat/core failure API; see the Jini patch. */
import type { AgentEvent, ChatMessage, ChatTransport, RunHandlers, StartRunInput } from "../../../react/kit.js";

import { redactCredentialShapes, redactSecretAssignments, stripControlCharacters, stripCsiSequences, stripOscSequences } from "./agent-failure-scanners.js";

import { isAbortError } from '@jini-ai/core/text';
export interface AgentFailureHint {
  readonly category: "auth" | "unsupported-client";
  /** Case-insensitive literal alternatives, scoped to this agent's own output. */
  readonly patterns: readonly string[];
  readonly hint: string;
  readonly suggestedAgentId?: string;
}

export interface FailureAgent {
  readonly id: string;
  readonly name: string;
  readonly available?: boolean;
  readonly failureHints?: readonly AgentFailureHint[];
}

export interface AgentFailure {
  readonly reason: string;
  readonly details: string;
  readonly agentId?: string;
}

export const AGENT_FAILURE_EVENT = "agent_failure";
export const GENERIC_AGENT_FAILURE = "The assistant could not continue this answer. Saved work is above.";

/** Strip CSI, OSC (including terminal hyperlinks) and remaining control characters first. */
export function redactAgentFailure({ text }: { text: string }, _optional = {}): string {
  const visible = stripControlCharacters({ text: stripCsiSequences({ text: stripOscSequences({ text }) }) });
  const bearerRedacted = redactCredentialShapes({ text: visible }).replace(/\b(Bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]");
  return redactSecretAssignments({ text: bearerRedacted })
    .replace(/(Authorization\s*:\s*(?:Basic|Token)\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:key|api[_-]?key|token|access_token|refresh_token|code)=)[^\s"'&#]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

const NOISE = /^(?:Warning:.*(?:256-color|color support)|YOLO mode is enabled|Code discovery:|Hook system message:|Ripgrep is not available|An unexpected critical error occurred:\s*$|Traceback \(most recent call last\):|\s*at\s|\s*File ")/i;
const STRUCTURE = /^(?:[{}\[\],]+|[a-z]\w*:\s|\.\.\.)/;
// "did not load": the daemon's MCP-bridge notice ("The assistant's tools did not load (MCP bridge \"jini\"
// status: pending)...") names no other error word when the bridge left no stderr.
const ERROR_PHRASES: readonly RegExp[] = [
  /\b\w*error\b/i,
  /\b(?:failed|failure|invalid|not valid|unauthorized|unauthenticated|denied|refused|exhausted)\b/i,
  /\b(?:could not|not logged in|not authenticated|authentication required|no longer supported|did not load)\b/i,
  /\bmissing.*key\b/i,
];

/** Whether the line names an error in any of `ERROR_PHRASES`' words, each as whole words. */
function isErrorLine({ line }: { line: string }, _options: Record<string, never> = {}): boolean {
  return ERROR_PHRASES.some((phrase) => phrase.test(line));
}
const GENERIC = /^(?:Run failed — the agent process exited without answering|This turn failed\.?$|The assistant could not (?:continue|finish) this answer\. Saved work is above\.?$|Stopped\.?$)/i;

function agentIdField({ agentId }: { agentId: string | undefined }, _options: Record<string, never> = {}): { agentId?: string } {
  return agentId ? { agentId } : {};
}

/** A malformed external error payload contributes nothing rather than throwing. */
function extErrorMessage({ data }: { data: unknown }, _options: Record<string, never> = {}): string[] {
  if (!data || typeof data !== "object") return [];
  const message = "message" in data ? data.message : undefined;
  return typeof message === "string" ? [message] : [];
}

/** Raw stderr, structured `error` ext events and error-like statuses are failure text; everything else is not. */
function eventFailureSources(event: AgentEvent): string[] {
  if (event.kind === "raw") return [event.line];
  if (event.kind === "ext") return event.name === "error" ? extErrorMessage({ data: event.data }) : [];
  if (event.kind === "status" && !GENERIC.test(event.label) && (event.code === "agent_error" || isErrorLine({ line: event.label }))) {
    return [[event.label, event.detail].filter(Boolean).join(" ")];
  }
  return [];
}

function isMeaningfulLine(line: string): boolean {
  return Boolean(line) && (!STRUCTURE.test(line) || /^(?:error|failure):/i.test(line)) && !GENERIC.test(line);
}

/** The last error sentence wins over trailing informational lines or an exception object dump. */
export function extractAgentFailure(
  { events, agentId }: { events: readonly AgentEvent[] | undefined; agentId?: string }, _optional = {},
): AgentFailure | null {
  const sources = (events ?? []).flatMap(eventFailureSources);
  const details = redactAgentFailure({ text: sources.join("\n") }, {}).trim();
  const lines = details.split(/\r?\n/).map(line => line.trim()).filter(line => !NOISE.test(line)).filter(isMeaningfulLine);
  const errors = lines.filter(line => isErrorLine({ line }));
  const reason = (errors[errors.length - 1] ?? lines[lines.length - 1])?.slice(0, 600);
  return reason ? { reason, details, ...agentIdField({ agentId }) } : null;
}

export function matchAgentFailureHint(
  { failure, hints }: { failure: AgentFailure; hints: readonly AgentFailureHint[] }, _optional = {},
): AgentFailureHint | undefined {
  const text = `${failure.reason}\n${failure.details}`.toLowerCase();
  return hints.find(rule => rule.patterns.some(pattern => pattern.length > 0 && text.includes(pattern.toLowerCase())));
}

export function suggestedFailureAgent(
  { hint, agents }: { hint: AgentFailureHint | undefined; agents: readonly FailureAgent[] }, _optional = {},
): FailureAgent | undefined {
  return hint?.suggestedAgentId ? agents.find(agent => agent.id === hint.suggestedAgentId && agent.available === true) : undefined;
}

function safeEvent(event: AgentEvent): AgentEvent {
  if (event.kind === "raw") return { ...event, line: redactAgentFailure({ text: event.line }, {}) };
  if (event.kind === "status") return { ...event, label: redactAgentFailure({ text: event.label }, {}),
    ...(event.detail === undefined ? {} : { detail: redactAgentFailure({ text: event.detail }, {}) }) };
  return event;
}

/** Drops any earlier projection, redacts what remains and appends one failure card (or the generic notice) for failed runs. */
function projectEvents(
  { events, failed, agentId }: { events: readonly AgentEvent[]; failed: boolean; agentId: string | undefined },
): AgentEvent[] {
  const kept = events.filter(event => (event.kind !== "ext" || event.name !== AGENT_FAILURE_EVENT) &&
    !(failed && event.kind === "status" && event.label === GENERIC_AGENT_FAILURE));
  const failure = failed ? extractAgentFailure({ events: kept, ...agentIdField({ agentId }) }, {}) : null;
  const fallback: AgentEvent[] = failed && !failure
    ? [failureEvent({ reason: GENERIC_AGENT_FAILURE, details: "The assistant stopped without reporting a cause.", ...agentIdField({ agentId }) })] : [];
  return [...kept.map(safeEvent), ...(failure ? [failureEvent(failure)] : fallback)];
}

export function projectAgentFailureMessage({ message }: { message: ChatMessage }, _optional = {}): ChatMessage {
  if (message.role !== "assistant") return message;
  return { ...message, events: projectEvents({ events: message.events ?? [], failed: message.runStatus === "failed", agentId: message.agentId }) };
}

function failureEvent(failure: AgentFailure): AgentEvent {
  return { kind: "ext", name: AGENT_FAILURE_EVENT, data: failure };
}

/** A start the operator stopped stays a rejection: Jini's run stream already dropped that turn on purpose. */
function stoppedStart({ error, input }: { error: unknown; input: StartRunInput }, _optional = {}): boolean {
  return isAbortError({ error }) || input.cancelSignal?.aborted === true || input.signal?.aborted === true;
}

/** No daemon run exists for a refused start; Jini treats an empty id as "nothing to stop or follow". */
const NO_RUN_ID = "";

function redactedError({ error }: { error: unknown }, _options: Record<string, never> = {}): Error {
  return new Error(redactAgentFailure({ text: error instanceof Error ? error.message : String(error) }, {}));
}

/** Wrap the existing transport; preserve optional checkpoint support and every lifecycle effect. */
export function withAgentFailureSurface({ transport }: { transport: ChatTransport }, _optional = {}): ChatTransport {
  function wrap({ handlers }: { handlers: RunHandlers }, { agentId }: { agentId?: string | undefined } = {}): RunHandlers {
    let events: AgentEvent[] = [];
    let failed = false;
    let errorEvent: Extract<AgentEvent, { kind: "status" }> | undefined;
    const onCheckpoint = handlers.onCheckpoint;
    return {
      ...handlers,
      onEvent(event) { events.push(event); handlers.onEvent(safeEvent(event)); },
      ...(onCheckpoint ? { onCheckpoint(message: ChatMessage) {
        events = message.events ?? [];
        failed = message.runStatus === "failed";
        agentId = message.agentId ?? agentId;
        onCheckpoint(projectAgentFailureMessage({ message: { ...message, ...agentIdField({ agentId }) } }, {}));
      } } : {}),
      onError(error) {
        failed = true;
        errorEvent = { kind: "status", code: "agent_error", label: error.message };
        events.push(errorEvent);
        const failure = extractAgentFailure({ events, ...agentIdField({ agentId }) }, {});
        if (failure) handlers.onEvent(failureEvent(failure));
        handlers.onError(new Error(redactAgentFailure({ text: error.message }, {})));
      },
      onDone(finalEvents) {
        // The durable final event array is authoritative, not a replay of the collected prefix.
        if (finalEvents.length > 0) events = finalEvents;
        const pending = errorEvent;
        if (pending && !events.some(event => event.kind === "status" && event.label === pending.label)) {
          events = [...events, pending];
        }
        handlers.onDone(projectEvents({ events, failed, agentId }));
      },
    };
  }
  return {
    ...transport,
    async startRun(input, handlers) {
      const sink = wrap({ handlers }, { agentId: input.agentId });
      try { return await transport.startRun(input, sink); }
      catch (error) {
        const safe = redactedError({ error });
        sink.onError(safe);
        if (stoppedStart({ error, input }, {})) throw safe;
        // A refused start (e.g. `POST /api/runs` → 500) resolves instead of rejecting: Jini removes a
        // rejected turn from the transcript, which silently dropped the operator's message. Resolved,
        // the turn stays with its failed reply carrying the error `sink.onError` just reported.
        return { runId: NO_RUN_ID };
      }
    },
    async reattachRun(runId, handlers, options) {
      const sink = wrap({ handlers });
      try { await transport.reattachRun(runId, sink, options); }
      catch (error) {
        const safe = redactedError({ error });
        sink.onError(safe);
        throw safe;
      }
    },
  };
}
