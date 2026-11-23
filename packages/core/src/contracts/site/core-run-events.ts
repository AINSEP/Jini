/**
 * @file The daemon run-stream frame and reduction-result shapes shared by live and saved chat turns.
 * Types only.
 *
 * Additive copy of the declarations in `@jini-ai/chat/core/run-events` (`core/run-events/entry.ts`).
 * The frame translators, readers and notices stay in chat, which keeps its identical declarations
 * and exports until the paired cutover. `RunFrameOutcome.terminal` spells out the three terminal
 * members of chat's runtime-derived `ChatRunStatus` (`Extract<ChatRunStatus, "succeeded" | "failed"
 * | "canceled">`), which is the same type.
 */

import type { AgentEvent } from "./chat-core.js";

export interface RunAgentPayload {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface RunProtocolEventWire {
  readonly runId: string;
  readonly kind: "start" | "agent" | "stdout" | "stderr" | "error" | "end";
  readonly payload: unknown;
}

/** A daemon `end` frame's non-successful terminal classification, as the daemon itself recorded it
 *  in `@jini-ai/protocol`'s `RunEndPayload`. */
export interface TerminalOutcome {
  readonly status: "failed" | "canceled";
  readonly code: string;
  readonly signal: string;
  readonly resumable: string;
}

/** What one daemon stream frame means for the turn: events to append, a failure, and whether it ended. */
export interface RunFrameOutcome {
  readonly events: AgentEvent[];
  /** Set when the frame reports a failure. Once any frame has, the turn is `failed` (the browser's
   *  `useRunStream` keeps an `'error'` status through a later `onDone`). */
  readonly error?: Error;
  /** Set only on the `end` frame: the daemon's own terminal classification. */
  readonly terminal?: "succeeded" | "failed" | "canceled";
}

/**
 * Per-connection memory for {@link translateRunFrame}: which channels are mid-way through an echo
 * line. Only a line's first chunk carries the {@link ECHO_LINE} prefix, so without it the rest of a
 * split `user` echo stays as `raw` — tool-result prose that durable recovery then reads as executor
 * diagnostics. Pass one fresh `{}` per daemon connection (each connection replays from event 0).
 */
export interface RunFrameCarry {
  openEchoChannels?: Set<string>;
}
