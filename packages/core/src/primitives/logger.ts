import { describeErrorForLog } from '../model-facing-tool-errors.js';

/** Host-independent logging contract: diagnostics travel as optional structured data. */
export interface Logger {
  info(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  warn(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
  error(required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }): void;
}

/** One log call exactly as the caller made it, original error objects included. */
export interface LogDiagnosticRecord {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly meta?: Record<string, unknown>;
  readonly error?: unknown;
}

/** A host-owned sink for full diagnostics; the host applies its own redaction and storage. */
export type LogDiagnosticsSink = (record: LogDiagnosticRecord) => void;

/**
 * Meta as a default sink may write it: `error`/`reason` keys and any Error-valued entry become
 * `describeErrorForLog` text (class + approved code). Other values pass through: they are the
 * caller's own structured fields (`runId`, counts), never a caught value.
 */
export function describeLogMeta(required: { meta: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(required.meta).map(([key, value]) => [
    key,
    key === 'error' || key === 'reason' || value instanceof Error ? describeErrorForLog({ err: value }) : value,
  ]));
}

/**
 * Minimal console adapter with a required host-owned prefix and structured metadata.
 * The console line carries safe metadata only: a caught error's text or stack can quote untrusted
 * input or a credential no redaction pattern knows. A host that wants the full error injects
 * `diagnostics`, which receives every call unchanged; a throwing sink never stops the console line.
 * @param required.prefix Host-owned line prefix ('' for none).
 * @param optional.diagnostics Host sink for the full record.
 * @complexity O(meta entries) per call.
 */
export function createConsoleLogger({ prefix }: { prefix: string }, { diagnostics }: { diagnostics?: LogDiagnosticsSink } = {}): Logger {
  const write = (level: LogDiagnosticRecord['level'], message: string, optional: { meta?: Record<string, unknown>; error?: unknown }) => {
    const line = prefix ? `${prefix} ${message}` : message;
    const args: unknown[] = [line];
    if (optional.meta !== undefined) args.push(describeLogMeta({ meta: optional.meta }));
    if (optional.error !== undefined) args.push(describeErrorForLog({ err: optional.error }));
    console[level](...args);
    if (diagnostics !== undefined) deliverDiagnostics({ diagnostics, record: { level, message: line, ...optional } });
  };
  return {
    info: ({ message }, optional = {}) => write('info', message, optional),
    warn: ({ message }, optional = {}) => write('warn', message, optional),
    error: ({ message }, optional = {}) => write('error', message, optional),
  };
}

function deliverDiagnostics({ diagnostics, record }: { diagnostics: LogDiagnosticsSink; record: LogDiagnosticRecord }): void {
  try {
    diagnostics(record);
  } catch (sinkError) {
    // The host sink failed: the console line above already recorded the call; record the sink's
    // own failure (class only) so it is not lost, and never throw from a log call.
    console.error(`${record.message} (diagnostics sink failed)`, describeErrorForLog({ err: sinkError }));
  }
}
