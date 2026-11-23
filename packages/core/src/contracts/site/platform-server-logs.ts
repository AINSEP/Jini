/**
 * @file The captured server log line and its level/source/metadata vocabulary. Types only.
 *
 * Generic, not host-specific: nothing here knows about sites, workspaces or the admin. A host's
 * in-memory ring buffer of recent server log lines, its rotating log-file sink and every reader
 * (an admin route, an assistant tool) share these shapes. The buffer, its caps and the console
 * tee stay with the host.
 *
 * Redaction is applied ON WRITE, never on read: a secret must not sit in memory waiting for a reader
 * to forget the redaction step, so `message` on a stored entry is already redacted.
 */

export type ServerLogLevel = "debug" | "info" | "warn" | "error";

/** Which process logged the line: the main server, or the agent daemon it supervises. */
export type ServerLogSource = "server" | "daemon";

/** Captured with each line so rotation and later async work cannot change its attribution. */
export interface ServerLogMetadata {
  readonly release?: string;
  readonly environment?: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface ServerLogEntry extends ServerLogMetadata {
  /** Monotonic within one process; lets a reader page forward without duplicates.
   * Total lines ever appended, including ones already dropped by the caps. */
  readonly seq: number;
  /** ISO-8601 time the line was captured. */
  readonly at: string;
  readonly level: ServerLogLevel;
  readonly source: ServerLogSource;
  /** Already redacted and length-capped. */
  readonly message: string;
}
