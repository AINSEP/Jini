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

/** Fixed words a default sink writes in place of a value it will not print. */
const OPAQUE_VALUE = '[object]';
const FUNCTION_VALUE = '[function]';
const SYMBOL_VALUE = '[symbol]';
const UNREADABLE_VALUE = '[unreadable]';
const TOO_DEEP_VALUE = '[nested too deep]';
/** Bounds per call: a log line is not a data dump, and a cycle must end. */
const MAX_META_DEPTH = 4;
const MAX_META_ENTRIES = 50;

/**
 * Meta as a default sink may write it, at every depth: `error`/`reason` keys and any `Error` become
 * `describeErrorForLog` text (class + approved code); plain objects and arrays are projected the same
 * way; any other object (a class instance, a Map, a response) becomes a fixed placeholder; strings,
 * numbers and booleans pass through as the caller's own structured fields (`runId`, counts).
 * Never throws: each field is read once inside a guard, so a throwing getter or a revoked Proxy
 * becomes `[unreadable]` instead of replacing the failure being logged. Originals reach only a host
 * `diagnostics` sink.
 * @complexity O(min(entries, 50) ^ depth), depth at most 4.
 */
export function describeLogMeta(required: { meta: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  try {
    return projectRecord({ record: required.meta, depth: 1 });
  } catch {
    // Even the key list could not be read (a Proxy whose `ownKeys` throws): fixed words only.
    return { meta: UNREADABLE_VALUE };
  }
}

function projectRecord({ record, depth }: { record: object; depth: number }): Record<string, unknown> {
  const keys = Object.keys(record).slice(0, MAX_META_ENTRIES);
  return Object.fromEntries(keys.map(key => [key, projectEntry({ key, read: () => (record as Record<string, unknown>)[key], depth })]));
}

function projectArray({ list, depth }: { list: readonly unknown[]; depth: number }): unknown[] {
  const length = Math.min(list.length, MAX_META_ENTRIES);
  return Array.from({ length }, (_, index) => projectEntry({ key: String(index), read: () => list[index], depth }));
}

/** One field, read once and projected; a throwing read or check becomes fixed words. */
function projectEntry({ key, read, depth }: { key: string; read: () => unknown; depth: number }): unknown {
  try {
    const value = read();
    if (key === 'error' || key === 'reason' || value instanceof Error) return describeErrorForLog({ err: value });
    return typeof value === 'object' && value !== null ? projectObject({ value, depth }) : projectScalar({ value });
  } catch {
    return UNREADABLE_VALUE;
  }
}

function projectObject({ value, depth }: { value: object; depth: number }): unknown {
  if (depth >= MAX_META_DEPTH) return TOO_DEEP_VALUE;
  if (Array.isArray(value)) return projectArray({ list: value, depth: depth + 1 });
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? projectRecord({ record: value, depth: depth + 1 }) : OPAQUE_VALUE;
}

function projectScalar({ value }: { value: unknown }): unknown {
  if (typeof value === 'function') return FUNCTION_VALUE;
  if (typeof value === 'symbol') return SYMBOL_VALUE;
  // JSON cannot write a bigint; its digits are the caller's own number.
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Minimal console adapter with a required host-owned prefix and structured metadata.
 * The console line carries safe metadata only: a caught error's text or stack can quote untrusted
 * input or a credential no redaction pattern knows. A host that wants the full error injects
 * `diagnostics`, which receives every call unchanged; a throwing sink never stops the console line.
 * @param required.prefix Host-owned line prefix ('' for none).
 * @param optional.diagnostics Host sink for the full record.
 * @complexity O(projected meta, see `describeLogMeta`) per call.
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
