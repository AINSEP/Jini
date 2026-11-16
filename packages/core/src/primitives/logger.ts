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
const TOO_LARGE_VALUE = '[too many entries]';
/** Bounds per call: a log line is not a data dump, and a cycle must end. Per-level limits alone still
 *  allowed ~50^3 entries on one call (meta of arrays of objects), so one total budget is shared by
 *  the whole projection; once spent, objects become {@link TOO_LARGE_VALUE} and further keys drop. */
const MAX_META_DEPTH = 4;
const MAX_META_ENTRIES = 50;
const MAX_META_TOTAL_ENTRIES = 200;
/** Entries still allowed in this call's projection; shared and decremented by every container. */
interface MetaBudget { left: number }
/** Payload keys: whatever sits under them is a caught value or its text, so it is described, never
 *  printed. `message`/`stack` belong here too: the line already has its own message. */
const PAYLOAD_KEY = /^(error|err|reason|cause|message|stack)$/;

/**
 * Meta as a default sink may write it, at every depth: a payload key (`error`, `err`, `reason`,
 * `cause`, `message`, `stack`), any `Error`, and any error-shaped object (own `message` or `stack`:
 * `throw { message }`, an upstream JSON error) become `describeErrorForLog` text (class + approved
 * code, `object`/`string` for a non-Error); other plain objects and arrays are projected the same
 * way; any other object (a class instance, a Map, a response) becomes a fixed placeholder; strings,
 * numbers and booleans under any other key pass through as the caller's own structured fields
 * (`runId`, counts). A caught value under a non-payload key is the log-safety gate's finding.
 * Never throws: each field is read once inside a guard, so a throwing getter or a revoked Proxy
 * becomes `[unreadable]` instead of replacing the failure being logged. Originals reach only a host
 * `diagnostics` sink.
 * @complexity O(200) projected entries per call (a shared budget; at most 50 per level, depth 4).
 */
export function describeLogMeta(required: { meta: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  try {
    const { meta } = required;
    // The whole meta can itself be a thrown plain object.
    if (isErrorShaped({ value: meta })) return { meta: describeErrorForLog({ err: meta }) };
    return projectRecord({ record: meta, depth: 1, budget: { left: MAX_META_TOTAL_ENTRIES } });
  } catch {
    // Even the key list could not be read (a Proxy whose `ownKeys` throws): fixed words only.
    return { meta: UNREADABLE_VALUE };
  }
}

/** An object carrying its own `message` or `stack`: a thrown value, whatever its prototype. May
 *  throw on a hostile Proxy; every caller is inside a guard. */
function isErrorShaped({ value }: { value: object }, _optional: Record<string, never> = {}): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'message') || Object.prototype.hasOwnProperty.call(value, 'stack');
}

/** How many of `available` entries this container may project; takes them from the shared budget. */
function takeEntries({ available, budget }: { available: number; budget: MetaBudget }, _optional: Record<string, never> = {}): number {
  const count = Math.min(available, MAX_META_ENTRIES, budget.left);
  budget.left -= count;
  return count;
}

function projectRecord({ record, depth, budget }: { record: object; depth: number; budget: MetaBudget }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const allKeys = Object.keys(record);
  const keys = allKeys.slice(0, takeEntries({ available: allKeys.length, budget }));
  return Object.fromEntries(keys.map(key => [key, projectEntry({ key, read: () => (record as Record<string, unknown>)[key], depth, budget })]));
}

function projectArray({ list, depth, budget }: { list: readonly unknown[]; depth: number; budget: MetaBudget }, _optional: Record<string, never> = {}): unknown[] {
  const length = takeEntries({ available: list.length, budget });
  return Array.from({ length }, (_, index) => projectEntry({ key: String(index), read: () => list[index], depth, budget }));
}

/** One field, read once and projected; a throwing read or check becomes fixed words. */
function projectEntry({ key, read, depth, budget }: { key: string; read: () => unknown; depth: number; budget: MetaBudget }, _optional: Record<string, never> = {}): unknown {
  try {
    const value = read();
    if (PAYLOAD_KEY.test(key) || value instanceof Error) return describeErrorForLog({ err: value });
    return typeof value === 'object' && value !== null ? projectObject({ value, depth, budget }) : projectScalar({ value });
  } catch {
    return UNREADABLE_VALUE;
  }
}

function projectObject({ value, depth, budget }: { value: object; depth: number; budget: MetaBudget }, _optional: Record<string, never> = {}): unknown {
  if (isErrorShaped({ value })) return describeErrorForLog({ err: value });
  if (depth >= MAX_META_DEPTH) return TOO_DEEP_VALUE;
  if (budget.left <= 0) return TOO_LARGE_VALUE;
  if (Array.isArray(value)) return projectArray({ list: value, depth: depth + 1, budget });
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? projectRecord({ record: value, depth: depth + 1, budget }) : OPAQUE_VALUE;
}

function projectScalar({ value }: { value: unknown }, _optional: Record<string, never> = {}): unknown {
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
  const write = ({ level, message }: { level: LogDiagnosticRecord['level']; message: string }, optional: { meta?: Record<string, unknown>; error?: unknown } = {}) => {
    const line = prefix ? `${prefix} ${message}` : message;
    const args: unknown[] = [line];
    if (optional.meta !== undefined) args.push(describeLogMeta({ meta: optional.meta }));
    if (optional.error !== undefined) args.push(describeErrorForLog({ err: optional.error }));
    console[level](...args);
    if (diagnostics !== undefined) deliverDiagnostics({ diagnostics, record: { level, message: line, ...optional } });
  };
  return {
    info: ({ message }, optional = {}) => write({ level: 'info', message }, optional),
    warn: ({ message }, optional = {}) => write({ level: 'warn', message }, optional),
    error: ({ message }, optional = {}) => write({ level: 'error', message }, optional),
  };
}

function deliverDiagnostics({ diagnostics, record }: { diagnostics: LogDiagnosticsSink; record: LogDiagnosticRecord }, _optional: Record<string, never> = {}): void {
  try {
    diagnostics(record);
  } catch (sinkError) {
    // The host sink failed: the console line above already recorded the call; record the sink's
    // own failure (class only) so it is not lost, and never throw from a log call.
    console.error(`${record.message} (diagnostics sink failed)`, describeErrorForLog({ err: sinkError }));
  }
}
