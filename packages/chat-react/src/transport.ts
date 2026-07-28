/**
 * @module transport
 *
 * The `ChatTransport` port — the single seam a host uses to reach a real
 * agent runtime (SSE/fetch, WebSocket, a local daemon, an in-memory fake for
 * tests). No hook or component in this package constructs an
 * `EventSource`/`fetch`/`WebSocket` directly; every one of them receives a
 * `ChatTransport` (via `<JiniChatProvider transport={...}>` or as a direct
 * hook argument) and calls through it instead.
 *
 * Generalizes OD's `providers/daemon.ts` `streamViaDaemon` +
 * `DaemonStreamHandlers` (`daemon.ts:261`, `daemon.ts:594`) — verified
 * against the real source at
 * `apps/web/src/providers/daemon.ts` (branch `refactor/web-chat-pane-slice`,
 * commit `58fe4358747bd08b82c36947f1ff05aa5fa6a02a`). See
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §2 for the target shape this
 * module implements verbatim.
 */
import type { AgentEvent, ChatAttachment, ChatMessage, RunStatus } from '@jini-ai/chat-core';

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
 * The transport port. A host binds exactly one implementation (a real
 * SSE/fetch adapter, a WebSocket adapter, or a fake for tests/demos) and
 * passes it to `<JiniChatProvider>`. Every headless hook in this package
 * that performs I/O receives this port — none constructs its own transport.
 */
export interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  /** Resume listening to an already-started run (reconnect/replay). */
  reattachRun(runId: string, handlers: RunHandlers): Promise<void>;
  fetchRunStatus(runId: string): Promise<RunStatus | null>;
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
