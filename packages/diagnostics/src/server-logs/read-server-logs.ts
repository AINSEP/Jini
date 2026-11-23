import type { ServerLogEntry, ServerLogLevel } from "@jini-ai/core/contracts/site/platform-server-logs";

/**
 * @file `readServerLogs` — the ONE read behind both a host's admin server-logs route
 * (`GET …/system/server-logs`) and its `system_read_server_logs` chat tool. Both call
 * `parseServerLogFilters` then `readServerLogs`, so a filter means the same thing in the UI and in
 * chat. Where the lines live is the host's: it injects a {@link ServerLogSourcePort}.
 */

export const SERVER_LOG_LEVELS = ["debug", "info", "warn", "error"] as const satisfies readonly ServerLogLevel[];
export const DEFAULT_SERVER_LOG_LIMIT = 100;
export const MAX_SERVER_LOG_LIMIT = 500;
export const MAX_CONTAINS_LENGTH = 200;

const SEVERITY: Record<ServerLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** What a reader needs from wherever the lines live (the in-memory buffer, or a log file). */
export interface ServerLogSourcePort {
  /** `capturing` is false when nothing records lines, so an empty result is not "no errors". */
  read(): { entries: readonly ServerLogEntry[]; capturing: boolean };
}

export interface ServerLogFilters {
  /** Minimum severity: "warn" returns warn and error. */
  readonly level?: ServerLogLevel | undefined;
  readonly sinceIso?: string | undefined;
  /** Case-insensitive substring of the message. */
  readonly contains?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ServerLogsResult {
  /** Oldest first; the newest `limit` matching lines. */
  readonly entries: readonly ServerLogEntry[];
  readonly matched: number;
  readonly buffered: number;
  readonly truncated: boolean;
  readonly capturing: boolean;
}

/** A filter value the caller sent that cannot be used. The message names the field. */
export class ServerLogFilterError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "ServerLogFilterError";
  }
}

function parseLevel({ raw }: { raw: unknown }, _optional = {}): ServerLogLevel | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw === "string" && (SERVER_LOG_LEVELS as readonly string[]).includes(raw)) return raw as ServerLogLevel;
  throw new ServerLogFilterError({ message: `level must be one of ${SERVER_LOG_LEVELS.join(", ")}` });
}

function parseSince({ raw }: { raw: unknown }, _optional = {}): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw === "string" && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  throw new ServerLogFilterError({ message: "sinceIso must be an ISO-8601 date-time, e.g. 2026-10-05T12:00:00Z" });
}

function parseContains({ raw }: { raw: unknown }, _optional = {}): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw === "string" && raw.length <= MAX_CONTAINS_LENGTH) return raw;
  throw new ServerLogFilterError({ message: `contains must be a string of at most ${MAX_CONTAINS_LENGTH} characters` });
}

function parseLimit({ raw }: { raw: unknown }, _optional = {}): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SERVER_LOG_LIMIT) return value;
  throw new ServerLogFilterError({ message: `limit must be an integer from 1 to ${MAX_SERVER_LOG_LIMIT}` });
}

/**
 * Validates filters from either a JSON tool input or an HTTP query (where every value is a string).
 * @param required The raw record; unknown keys are ignored here (the tool schema refuses them).
 * @returns Normalized filters.
 * @throws {ServerLogFilterError} Naming the first unusable field.
 * @complexity O(1).
 */
export function parseServerLogFilters(required: { raw: Record<string, unknown> }): ServerLogFilters {
  const { raw } = required;
  return { level: parseLevel({ raw: raw.level }), sinceIso: parseSince({ raw: raw.sinceIso }), contains: parseContains({ raw: raw.contains }), limit: parseLimit({ raw: raw.limit }) };
}

function matches(
  { entry, filters, sinceMs, needle }: { entry: ServerLogEntry; filters: ServerLogFilters; sinceMs: number | null; needle: string | null },
  _optional = {}
): boolean {
  if (filters.level && SEVERITY[entry.level] < SEVERITY[filters.level]) return false;
  if (sinceMs !== null && Date.parse(entry.at) < sinceMs) return false;
  return needle === null || entry.message.toLowerCase().includes(needle);
}

/**
 * Returns the newest matching server log lines. Read-only; lines were redacted when captured.
 * @param required The log source port.
 * @param optional Filters from `parseServerLogFilters`.
 * @returns Matching lines (oldest first) plus counts so a caller can say what was left out.
 * @complexity O(n) over buffered lines (n <= the buffer cap).
 * @example readServerLogs({ logs }, { level: "error", limit: 20 });
 */
export function readServerLogs(required: { logs: ServerLogSourcePort }, optional: ServerLogFilters = {}): ServerLogsResult {
  const { entries: all, capturing } = required.logs.read();
  const sinceMs = optional.sinceIso ? Date.parse(optional.sinceIso) : null;
  const needle = optional.contains ? optional.contains.toLowerCase() : null;
  const matching = all.filter(entry => matches({ entry, filters: optional, sinceMs, needle }));
  const limit = optional.limit ?? DEFAULT_SERVER_LOG_LIMIT;
  return {
    entries: matching.slice(-limit),
    matched: matching.length,
    buffered: all.length,
    truncated: matching.length > limit,
    capturing,
  };
}
