/**
 * @file Daemon run-stream frame contracts shared by live and saved chat turns.
 *
 * The type-only half of `@jini-ai/chat/core/run-events` (which re-exports these names): the wire
 * frame a daemon run streams, the per-frame translation outcome, the terminal classification read
 * off an `end` frame, and the per-connection carry. The translation itself (`translateRunFrame`,
 * notices, SSE reading) stays in the chat package; only the shapes live here so a host or another
 * engine package can name them without importing chat.
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
  /** Set only on the `end` frame: the daemon's own terminal classification. These are exactly the
   *  terminal members of `@jini-ai/chat/core`'s `ChatRunStatus` (declared there from a runtime
   *  `as const` tuple, so it cannot live in this type-only module); the chat package's
   *  `run-events/entry.ts` pins the two together at compile time. */
  readonly terminal?: "succeeded" | "failed" | "canceled";
}

/**
 * Per-connection memory for `translateRunFrame`: which channels are mid-way through an echo
 * line. Only a line's first chunk carries the `ECHO_LINE` prefix, so without it the rest of a
 * split `user` echo stays as `raw` — tool-result prose that durable recovery then reads as executor
 * diagnostics. Pass one fresh `{}` per daemon connection (each connection replays from event 0).
 */
export interface RunFrameCarry {
  openEchoChannels?: Set<string>;
}
