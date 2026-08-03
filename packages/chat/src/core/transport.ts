/**
 * @module transport
 *
 * The `ChatTransport` port — the single seam a host uses to reach a real
 * agent runtime (SSE/fetch, WebSocket, a local daemon, an in-memory fake for
 * tests).
 *
 * Moved here from `@jini-ai/chat-react` on 2026-07-29. The port is pure types over
 * `AbortSignal` — no React, no DOM, no transport implementation — so keeping it in the React
 * adapter meant a non-React host had to depend on the React package just to name the seam it
 * implements. `@jini-ai/chat-react` re-exports every name below, so nothing that already imported
 * them from there needs to change; no hook or component there constructs an
 * `EventSource`/`fetch`/`WebSocket` directly — each receives a `ChatTransport` (via
 * `<JiniChatProvider transport={...}>` or as a direct hook argument) and calls through it.
 *
 * Generalizes OD's `providers/daemon.ts` `streamViaDaemon` +
 * `DaemonStreamHandlers` (`daemon.ts:261`, `daemon.ts:594`) — verified
 * against the real source at
 * `apps/web/src/providers/daemon.ts` (branch `refactor/web-chat-pane-slice`,
 * commit `58fe4358747bd08b82c36947f1ff05aa5fa6a02a`). See
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §2 for the target shape this
 * module implements verbatim.
 */
import type { AgentEvent } from './events.js';
import type { ChatAttachment, ChatMessage, ChatRunStatus } from './messages.js';

/**
 * Per-run event handlers a `ChatTransport` invokes as a run streams.
 * Mirrors `DaemonStreamHandlers` (`onAgentEvent`/`onToolInputDelta`) plus the
 * generic `StreamHandlers` `onError`/`onDone` pair the OD original composed
 * via `extends`.
 */
export interface RunHandlers {
  /** Fired once per renderable unit of agent output. */
  onEvent: (ev: AgentEvent) => void;
  /**
   * Live-only incremental tool-input fragment (e.g. Claude's
   * `input_json_delta`). Ephemeral — never persisted; a consumer accumulates
   * by tool-use `id` for a live preview and discards it once the full
   * `tool_use` event arrives.
   */
  onToolInputDelta?: (id: string, name: string, delta: string) => void;
  onError: (err: Error) => void;
  /** Fired once the run reaches a terminal state, with the full event log. */
  onDone: (finalEvents: AgentEvent[]) => void;
}

/**
 * Opaque per-host payload threaded through to the transport unmodified (OD:
 * `projectId`/`skillIds`/`designSystemId`; another host: whatever its own
 * run-scoping concept is). This package never reads its fields.
 */
export type RunContext = Record<string, unknown>;

export interface StartRunInput {
  history: ChatMessage[];
  agentId?: string;
  conversationId?: string | null;
  attachments?: ChatAttachment[];
  context?: RunContext;
  /** Stops the browser-side subscription; the run continues host-side. */
  signal: AbortSignal;
  /** Explicit user cancellation — distinct from `signal` (see OD's `cancelSignal`). */
  cancelSignal?: AbortSignal;
}

/**
 * Per-reattachment options. Separate from the positional `runId`/`handlers` pair, and optional, so
 * an existing implementation stays type-compatible without edits.
 */
export interface ReattachRunOptions {
  /**
   * Stops the browser-side subscription; the run continues host-side. Exactly what
   * `StartRunInput.signal` is to `startRun`.
   *
   * `reattachRun` had no cancellation seam at all until 2026-07-29, and that was a resource leak
   * rather than a missing convenience: a reattached SSE/WebSocket stream can outlive the component
   * that opened it by as long as the run itself runs, and the shipped `useRunStream` hook was
   * already creating (and aborting on unmount/reset/replacement) a controller it had no way to hand
   * to the transport. The connection and its read loop simply kept going.
   */
  readonly signal?: AbortSignal;
}

/**
 * The transport port. A host binds exactly one implementation (a real
 * SSE/fetch adapter, a WebSocket adapter, or a fake for tests/demos) and
 * passes it to `<JiniChatProvider>`. Every headless hook in this package
 * that performs I/O receives this port — none constructs its own transport.
 */
export interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  /**
   * Resume listening to an already-started run (reconnect/replay).
   *
   * An implementation that opens a long-lived stream **must** honor `options.signal` — it is the
   * only way a caller can detach. See {@link ReattachRunOptions.signal}.
   */
  reattachRun(runId: string, handlers: RunHandlers, options?: ReattachRunOptions): Promise<void>;
  fetchRunStatus(runId: string): Promise<ChatRunStatus | null>;
  stopRun(runId: string): Promise<void>;
  reportFeedback?(change: FeedbackChange): Promise<void>;
}

export interface FeedbackChange {
  messageId: string;
  runId?: string;
  rating: 'positive' | 'negative';
  reasonCode?: string;
  note?: string;
}

export type OnFeedback = (change: FeedbackChange) => void;
