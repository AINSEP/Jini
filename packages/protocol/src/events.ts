import type { RunErrorPayload } from './errors.js';

export const RUN_PROTOCOL_VERSION = 1;

/**
 * Transport-neutral run-event envelope. HTTP/SSE, CLI JSON-lines, MCP
 * notifications, and the sidecar wire format are each a projection of this
 * shape — none of them owns it (extraction-plan §12 C2: one canonical event
 * envelope, not an SSE-shaped one).
 *
 * **Fixed 2026-07-19** (swarm-consensus architecture debate, Claude Fable 5 finding F-B —
 * see `ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md`): the
 * shipped shape used to be exactly `{ id, event, data }` — SSE's own three wire fields, the
 * literal anti-pattern this module's doc comment already warned against while not actually
 * avoiding it. The fields below are C2's full envelope.
 */
export interface RunEvent<Name extends string, Payload> {
  /** The run this event belongs to. Lets one multiplexed connection carrying many runs' events attribute each event without external bookkeeping (impossible with the pre-fix shape). */
  runId: string;
  /**
   * Globally unique id for this specific event delivery, for client-side at-least-once-
   * delivery dedup (extraction-plan §12 C2: "delivery is at-least-once and the client
   * reducer deduplicates"). Distinct from `opaqueCursor`: this identifies the event, that
   * identifies a position to resume *from*. Today derived deterministically as
   * `` `${runId}:${opaqueCursor}` ``, never caller-supplied.
   */
  eventId: string;
  /** Monotonic per-run cursor for replay/reconnect (a transport's Last-Event-ID is one projection of this). Always assigned by the durable EventLog kernel port — never by a caller or a transport. */
  opaqueCursor: string;
  readonly protocolVersion: typeof RUN_PROTOCOL_VERSION;
  /** Epoch-ms wall-clock time the event was recorded (`EventLogEntry.recordedAt`). Silently dropped by the pre-fix envelope. */
  ts: number;
  kind: Name;
  payload: Payload;
  /**
   * `'durable'` for every event today: `opaqueCursor` only ever references committed,
   * replayable entries — there is no ephemeral/non-replayable delivery channel implemented
   * yet. `RunAgentPayload`'s `tool_input_delta`/`thinking_delta` streaming-preview variants
   * are the likely first candidates for a future `'ephemeral'` channel (extraction-plan §12
   * C2: "ephemeral previews... are a separate explicitly-non-replayable channel"), but
   * building that channel is separate, larger work. This field exists now so a future
   * ephemeral producer doesn't have to widen the envelope type again.
   */
  durability: 'durable' | 'ephemeral';
}

export type RunEventName<Event> = Event extends RunEvent<infer Name, unknown> ? Name : never;

export type RunEventPayload<Event, Name extends string> = Event extends RunEvent<Name, infer Payload>
  ? Payload
  : never;

export interface RunStartPayload {
  runId: string;
  /** Opaque caller-owned grouping reference. Persisted so a lifecycle can rebuild its run index after a host restart. */
  contextRef: string;
  agentId?: string;
  /** Caller-supplied idempotency key; a duplicate start with the same key must replay the existing run rather than starting a second one. */
  idempotencyKey?: string;
}

export interface RunChunkPayload {
  chunk: string;
}

export interface RunEndPayload {
  code: number | null;
  signal?: string | null;
  status?: 'succeeded' | 'failed' | 'canceled';
  /** True when a `failed` run can be recovered by resuming the underlying agent-CLI session instead of starting a new run. */
  resumable?: boolean;
  /**
   * The child agent CLI's own session/thread identifier, when its stream reported one (e.g.
   * OpenCode's `sessionID`, Codex's `thread_id`, Qoder's/Claude's `session_id`) — gap 5 of the
   * run/chat orchestration swarm-consensus Final Recommendation. A host reads this after a run
   * ends to link its *own* next `start()` call (new `runId`, same `contextRef`) back to the
   * underlying CLI session, e.g. passing a resume flag to the next spawn. This is metadata for a
   * host's own follow-up run, not something `RunLifecycle.resume()` itself uses — `resume()`
   * remains a pure attempt-recovery state-machine flip on the same run, unaffected by this field.
   */
  sessionRef?: string;
}

export type RunAgentPayload =
  | { type: 'status'; label: string; model?: string; ttftMs?: number; detail?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_input_delta'; id: string; name: string; delta: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; usage?: { input_tokens?: number; output_tokens?: number }; costUsd?: number; durationMs?: number }
  | { type: 'raw'; line: string }
  /**
   * Announces a named sub-stage of a multi-step agent run beginning/ending — generic scaffolding
   * for any driver that structures its work into stages (a build pipeline, a multi-pass review,
   * a plan/execute/verify loop), not tied to any one product's own pipeline concept. Added for
   * `@jini-ai/agui`'s generalization of OD's `pipeline_stage_started`/`pipeline_stage_completed`
   * events — see `packages/agentic/source-map.md` for the full reasoning and two-consumer
   * justification. Flows through the existing `RunLifecycle.emit('agent', ...)` channel exactly
   * like `tool_use`/`tool_result` already do; no driver in this codebase produces these yet.
   */
  | { type: 'stage_start'; stageId: string; label?: string; iteration?: number }
  | { type: 'stage_end'; stageId: string; iteration?: number }
  /**
   * A human-in-the-loop request/response pair: the agent asks a structured question (with an
   * opaque, caller-defined `payload`) and gets an arbitrary `value` back. Generic scaffolding for
   * "the agent needs the user to answer something mid-run" — not a UI component/data-binding
   * protocol (see the real, much larger A2UI spec at a2ui.org for that different, out-of-scope
   * problem). Added for `@jini-ai/agui`'s generalization of OD's `genui_surface_request`/
   * `genui_surface_response`/`genui_surface_timeout` events — see `packages/agentic/source-map.md`.
   * A timeout is represented as a `surface_response` with `respondedBy: 'auto'`, mirroring OD's
   * own collapsing of its two response-shaped event kinds into one. No driver in this codebase
   * produces these yet.
   */
  | { type: 'surface_request'; surfaceId: string; surfaceKind: 'form' | 'choice' | 'confirmation' | 'oauth-prompt'; payload: unknown }
  | { type: 'surface_response'; surfaceId: string; value: unknown; respondedBy: 'user' | 'agent' | 'auto' | 'cache' }
  /**
   * Carries one real A2UI (a2ui.org v1.0) agent→renderer envelope message verbatim — `createSurface`
   * / `updateComponents` / `updateDataModel` / `deleteSurface` / `callFunction` / `actionResponse`,
   * unlike `surface_request`/`surface_response` above (which are a narrower, unrelated "ask a
   * structured question, get a value back" primitive with no component tree or data binding — see
   * that variant's own doc, written before A2UI was implemented in this codebase, for the
   * distinction). `message` is typed `unknown` rather than importing `@jini-ai/agentic`'s own message
   * union deliberately: `@jini-ai/protocol` sits below every other package in the dependency graph and
   * must not depend sideways on a feature package for this one variant's shape — the real,
   * structural validation happens where the type IS known, in `@jini-ai/agentic/a2ui`'s own
   * `parseAgentToRendererMessage` on the consuming side. Added for the A2UI build-then-break task;
   * see `examples/reference-web/src/daemon.ts`'s `runA2uiDemo` for the one producer that exists
   * today, and `examples/reference-web/src/A2uiLab.tsx` for the one consumer.
   */
  | { type: 'a2ui'; message: unknown };

export type RunProtocolEvent =
  | RunEvent<'start', RunStartPayload>
  | RunEvent<'agent', RunAgentPayload>
  | RunEvent<'stdout', RunChunkPayload>
  | RunEvent<'stderr', RunChunkPayload>
  | RunEvent<'error', RunErrorPayload>
  | RunEvent<'end', RunEndPayload>;
