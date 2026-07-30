/** @module run/diagnostics/diagnostics — Stderr/stdout tail collection and diagnostic analytics summarization for completed runs. */

/**
 * Scrubs secrets/PII from a stream tail before it is stored or emitted. The
 * engine provides the tail-collection mechanism but takes no opinion on the
 * scrubbing policy: a consumer injects its own redactor (e.g. `@jini-ai/core`'s
 * `redactSecrets`). Defaults to identity so a caller that has already scrubbed —
 * or genuinely wants the raw tail — need not pass one.
 */
export type TailRedactor = (text: string) => string;

const identityRedactor: TailRedactor = (text) => text;

/** A recorded run event entry passed to diagnostics collection functions for scanning. */
export interface RunEventForDiagnostics {
  event: string;
  data: unknown;
}

/** Identifies which signal was the primary source of diagnostic information for a failed run. */
export type RunDiagnosticSource =
  | 'error_event'
  | 'stderr'
  | 'exit_code'
  | 'signal'
  | 'unknown';

/** Bucketed stderr (and stdout) line count for low-cardinality analytics grouping. */
export type StderrLineCountBucket =
  | 'none'
  | '1_5'
  | '6_20'
  | '21_100'
  | 'gt_100';

/** The mechanism that ended the run's child process or RPC session, derived from events and exit signals. */
export type RunCloseReason =
  | 'exit_0'
  | 'exit_nonzero'
  | 'signal'
  | 'cancel_requested'
  | 'stream_error'
  | 'fatal_rpc_error'
  | 'empty_output'
  | 'unknown';

/** Diagnostic fields included in the `run_finished` analytics payload, summarizing what was observed at run end. */
export interface RunDiagnosticsAnalytics {
  diagnostic_source: RunDiagnosticSource;
  stderr_present: boolean;
  stderr_line_count_bucket: StderrLineCountBucket;
  stdout_present: boolean;
  stdout_line_count_bucket: StderrLineCountBucket;
  rpc_close_reason: RunCloseReason;
  first_token_seen: boolean;
  user_visible_output_seen: boolean;
  tool_call_seen: boolean;
  artifact_write_seen: boolean;
  live_artifact_seen: boolean;
  // True when this run transparently re-seeded after an upstream session resume
  // failed (expired/pruned): the dead handle was cleared and the turn was re-run
  // with a fresh session + full transcript, with no user-facing error. Lets us
  // monitor how often the resume optimization falls back (should be rare).
  resume_auto_reseeded: boolean;
}

/** Redacted, byte-capped tail of a stream (stderr or stdout) collected after a run completes. */
export interface StreamTailSummary {
  tail: string;
  lineCount: number;
  truncated: boolean;
}

/** Tail summary specifically for the stderr stream; alias of `StreamTailSummary` for call-site clarity. */
export type StderrTailSummary = StreamTailSummary;
/** Tail summary specifically for the stdout stream; alias of `StreamTailSummary` for call-site clarity. */
export type StdoutTailSummary = StreamTailSummary;

const STDERR_TAIL_MAX_LINES = 20;
const STDERR_TAIL_MAX_BYTES = 4 * 1024;

function readStderrChunk(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.chunk === 'string') return obj.chunk;
  if (typeof obj.text === 'string') return obj.text;
  return null;
}

function readStdoutChunk(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.chunk === 'string') return obj.chunk;
  if (typeof obj.text === 'string') return obj.text;
  return null;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).filter((line) => line.length > 0).length;
}

/**
 * Maps a raw stderr (or stdout) line count to a low-cardinality analytics bucket.
 * @param count - Total number of non-empty lines in the stream.
 * @returns A `StderrLineCountBucket` string for use in analytics payloads.
 */
export function stderrLineCountBucket(count: number): StderrLineCountBucket {
  if (count <= 0) return 'none';
  if (count <= 5) return '1_5';
  if (count <= 20) return '6_20';
  if (count <= 100) return '21_100';
  return 'gt_100';
}

function truncateUtf8(value: string, maxBytes: number): {
  value: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes <= maxBytes) return { value, truncated: false };
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }
  return { value: value.slice(0, end), truncated: true };
}

function collectStreamTailSummary(
  events: RunEventForDiagnostics[],
  eventName: string,
  readChunk: (data: unknown) => string | null,
  redact: TailRedactor,
): StreamTailSummary | undefined {
  let streamText = '';
  for (const event of events) {
    if (event.event !== eventName) continue;
    const chunk = readChunk(event.data);
    if (chunk) streamText += chunk;
  }
  const lineCount = countLines(streamText);
  if (lineCount <= 0) return undefined;

  const lines = streamText.trimEnd().split(/\r?\n/);
  const tailLines = lines.slice(-STDERR_TAIL_MAX_LINES);
  const lineTruncated = lines.length > tailLines.length;
  const redacted = redact(tailLines.join('\n'));
  const byteCapped = truncateUtf8(redacted, STDERR_TAIL_MAX_BYTES);

  return {
    tail: byteCapped.value,
    lineCount,
    truncated: lineTruncated || byteCapped.truncated,
  };
}

/**
 * Collects the tail of the stderr stream from a run's event list, scrubbed by the
 * supplied redactor. Returns `undefined` when no stderr output was recorded.
 * @param events - Recorded run events; only 'stderr' events are processed.
 * @param redact - Secret/PII scrubber applied to the joined tail; defaults to identity.
 * @returns A `StderrTailSummary` with the last 20 lines (capped at 4 KB) and a truncation flag, or `undefined`.
 */
export function collectStderrTailSummary(
  events: RunEventForDiagnostics[] = [],
  redact: TailRedactor = identityRedactor,
): StderrTailSummary | undefined {
  return collectStreamTailSummary(events, 'stderr', readStderrChunk, redact);
}

/**
 * Collects the tail of the stdout stream from a run's event list, scrubbed by the
 * supplied redactor. Returns `undefined` when no stdout output was recorded.
 * @param events - Recorded run events; only 'stdout' events are processed.
 * @param redact - Secret/PII scrubber applied to the joined tail; defaults to identity.
 * @returns A `StdoutTailSummary` with the last 20 lines (capped at 4 KB) and a truncation flag, or `undefined`.
 */
export function collectStdoutTailSummary(
  events: RunEventForDiagnostics[] = [],
  redact: TailRedactor = identityRedactor,
): StdoutTailSummary | undefined {
  return collectStreamTailSummary(events, 'stdout', readStdoutChunk, redact);
}

/** The set of `rpc_close_reason` strings a `runtime_close` diagnostic may legitimately carry. */
const RECOGNIZED_CLOSE_REASONS: ReadonlySet<string> = new Set<RunCloseReason>([
  'exit_0',
  'exit_nonzero',
  'signal',
  'cancel_requested',
  'stream_error',
  'fatal_rpc_error',
  'empty_output',
  'unknown',
]);

/** Coerces an event's `data` to a property bag so `data.type` probing never throws on a scalar/array payload. */
function eventDataRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

/**
 * Reads the authoritative close reason a driver recorded on a `runtime_close` diagnostic event,
 * or `null` when this event carries none (or carries an unrecognized value).
 */
function readRecordedCloseReason(
  event: RunEventForDiagnostics,
  data: Record<string, unknown>,
): RunCloseReason | null {
  if (event.event !== 'diagnostic' || data.type !== 'runtime_close') return null;
  const reason = data.rpc_close_reason;
  if (typeof reason !== 'string') return null;
  return RECOGNIZED_CLOSE_REASONS.has(reason) ? reason as RunCloseReason : null;
}

/** True when this event is a non-empty streamed text/thinking delta — i.e. output a user actually saw. */
function hasVisibleTextDelta(data: Record<string, unknown>): boolean {
  if (data.type !== 'text_delta' && data.type !== 'thinking_delta') return false;
  return typeof data.delta === 'string' && data.delta.length > 0;
}

/** Mutable accumulator threaded through a single pass over a run's event list. */
interface RunEventObservations {
  stderr: string;
  stdout: string;
  hasErrorEvent: boolean;
  userVisibleOutputSeen: boolean;
  toolCallSeen: boolean;
  artifactWriteSeen: boolean;
  liveArtifactSeen: boolean;
  recordedCloseReason: RunCloseReason | null;
  resumeAutoReseeded: boolean;
}

/** Accumulates the raw stderr/stdout text carried by this event, if it is a stream chunk. */
function accumulateStreamChunk(observed: RunEventObservations, event: RunEventForDiagnostics): void {
  if (event.event === 'stderr') {
    const chunk = readStderrChunk(event.data);
    if (chunk) observed.stderr += chunk;
    return;
  }
  if (event.event === 'stdout') {
    const chunk = readStdoutChunk(event.data);
    if (chunk) {
      observed.stdout += chunk;
      observed.userVisibleOutputSeen = true;
    }
  }
}

/** Latches the observed-behavior flags (visible output, tool calls, artifacts, resume re-seed) for one event. */
function accumulateObservedFlags(
  observed: RunEventObservations,
  event: RunEventForDiagnostics,
  data: Record<string, unknown>,
): void {
  if (hasVisibleTextDelta(data)) observed.userVisibleOutputSeen = true;
  if (data.type === 'tool_use') observed.toolCallSeen = true;
  if (data.type === 'artifact') observed.artifactWriteSeen = true;
  if (data.type === 'live_artifact' || event.event === 'live_artifact') {
    observed.liveArtifactSeen = true;
  }
  if (event.event === 'diagnostic' && data.type === 'agent_resume_auto_reseed') {
    observed.resumeAutoReseeded = true;
  }
}

/** Folds one event into the accumulator. */
function accumulateEvent(observed: RunEventObservations, event: RunEventForDiagnostics): void {
  if (event.event === 'error') observed.hasErrorEvent = true;
  accumulateStreamChunk(observed, event);
  const data = eventDataRecord(event.data);
  accumulateObservedFlags(observed, event, data);
  const closeReason = readRecordedCloseReason(event, data);
  if (closeReason) observed.recordedCloseReason = closeReason;
}

/**
 * Single pass over a run's event list collecting every diagnostic signal the analytics payload
 * needs. Seeded with the daemon-supplied artifact flags so an event stream that never mentions an
 * artifact still reports what finalization already knew.
 */
function scanRunEvents(
  events: RunEventForDiagnostics[],
  seed: { artifactWriteSeen: boolean; liveArtifactSeen: boolean },
): RunEventObservations {
  const observed: RunEventObservations = {
    stderr: '',
    stdout: '',
    hasErrorEvent: false,
    userVisibleOutputSeen: false,
    toolCallSeen: false,
    artifactWriteSeen: seed.artifactWriteSeen,
    liveArtifactSeen: seed.liveArtifactSeen,
    recordedCloseReason: null,
    resumeAutoReseeded: false,
  };
  for (const event of events) {
    accumulateEvent(observed, event);
  }
  return observed;
}

/** Picks the single most informative signal available about why the run ended, in priority order. */
function resolveDiagnosticSource(signals: {
  hasErrorEvent: boolean;
  stderrPresent: boolean;
  signal: string | null | undefined;
  exitCode: number | null | undefined;
}): RunDiagnosticSource {
  if (signals.hasErrorEvent) return 'error_event';
  if (signals.stderrPresent) return 'stderr';
  if (signals.signal) return 'signal';
  if (typeof signals.exitCode === 'number') return 'exit_code';
  return 'unknown';
}

/**
 * Resolves the mechanism that closed the run. A reason a driver explicitly recorded always wins;
 * otherwise the daemon's own finalization flags are consulted in priority order, falling back to
 * the raw process exit signal/code.
 */
function resolveRpcCloseReason(
  recordedCloseReason: RunCloseReason | null,
  signals: {
    cancelRequested?: boolean;
    fatalRpcErrorSeen?: boolean;
    streamErrorSeen?: boolean;
    emptyOutputFailure?: boolean;
    signal?: string | null;
    exitCode?: number | null;
  },
): RunCloseReason {
  if (recordedCloseReason) return recordedCloseReason;
  if (signals.cancelRequested === true) return 'cancel_requested';
  if (signals.fatalRpcErrorSeen === true) return 'fatal_rpc_error';
  if (signals.streamErrorSeen === true) return 'stream_error';
  if (signals.emptyOutputFailure === true) return 'empty_output';
  if (signals.signal) return 'signal';
  if (typeof signals.exitCode !== 'number') return 'unknown';
  return signals.exitCode === 0 ? 'exit_0' : 'exit_nonzero';
}

/**
 * Produces the full `RunDiagnosticsAnalytics` payload for a completed run by scanning its event stream
 * and combining observed flags (tool calls, artifact writes, first token) with process-level signals.
 * @param args - Run events, exit code, signal, and boolean flags set by the daemon during finalization.
 * @returns A `RunDiagnosticsAnalytics` object ready to spread into the `run_finished` analytics event.
 */
export function summarizeRunDiagnosticsForAnalytics(args: {
  events?: RunEventForDiagnostics[];
  exitCode?: number | null;
  signal?: string | null;
  cancelRequested?: boolean;
  streamErrorSeen?: boolean;
  fatalRpcErrorSeen?: boolean;
  emptyOutputFailure?: boolean;
  firstTokenSeen?: boolean;
  artifactWriteSeen?: boolean;
  liveArtifactSeen?: boolean;
}): RunDiagnosticsAnalytics {
  const observed = scanRunEvents(args.events ?? [], {
    artifactWriteSeen: args.artifactWriteSeen === true,
    liveArtifactSeen: args.liveArtifactSeen === true,
  });
  const stderrLineCount = countLines(observed.stderr);
  const stdoutLineCount = countLines(observed.stdout);
  const stderrPresent = stderrLineCount > 0;
  const stdoutPresent = stdoutLineCount > 0;

  return {
    diagnostic_source: resolveDiagnosticSource({
      hasErrorEvent: observed.hasErrorEvent,
      stderrPresent,
      signal: args.signal,
      exitCode: args.exitCode,
    }),
    stderr_present: stderrPresent,
    stderr_line_count_bucket: stderrLineCountBucket(stderrLineCount),
    stdout_present: stdoutPresent,
    stdout_line_count_bucket: stderrLineCountBucket(stdoutLineCount),
    rpc_close_reason: resolveRpcCloseReason(observed.recordedCloseReason, args),
    first_token_seen: args.firstTokenSeen === true,
    user_visible_output_seen: observed.userVisibleOutputSeen,
    tool_call_seen: observed.toolCallSeen,
    artifact_write_seen: observed.artifactWriteSeen,
    live_artifact_seen: observed.liveArtifactSeen,
    resume_auto_reseeded: observed.resumeAutoReseeded,
  };
}
