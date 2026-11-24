import { expect, it } from "vitest";

import type { ServerLogEntry } from "@jini-ai/core/contracts/site/platform-server-logs";
import {
  DEFAULT_SERVER_LOG_LIMIT,
  MAX_CONTAINS_LENGTH,
  MAX_SERVER_LOG_LIMIT,
  parseServerLogFilters,
  readServerLogs,
  SERVER_LOG_LEVELS,
  ServerLogFilterError,
  type ServerLogSourcePort,
} from "../read-server-logs.js";

function entry(seq: number, level: ServerLogEntry["level"], message: string, at = `2026-10-05T12:00:0${seq}.000Z`): ServerLogEntry {
  return { seq, at, level, source: "server", message };
}
const ENTRIES = [entry(1, "debug", "tick"), entry(2, "info", "listening on 3000"), entry(3, "warn", "slow query"), entry(4, "error", "Route POST /x failed"), entry(5, "error", "DB locked")];
const source = (entries: readonly ServerLogEntry[] = ENTRIES, capturing = true): ServerLogSourcePort => ({ read: () => ({ entries, capturing }) });

it("no filters returns everything oldest first with counts", () => {
  expect(readServerLogs({ logs: source() })).toEqual({ entries: ENTRIES, matched: 5, buffered: 5, truncated: false, capturing: true });
});

it("level is a minimum severity", () => {
  expect(readServerLogs({ logs: source() }, { level: "warn" }).entries.map(e => e.seq)).toEqual([3, 4, 5]);
  expect(readServerLogs({ logs: source() }, { level: "error" }).entries.map(e => e.seq)).toEqual([4, 5]);
});

it("sinceIso is inclusive and contains is case-insensitive", () => {
  expect(readServerLogs({ logs: source() }, { sinceIso: "2026-10-05T12:00:03.000Z" }).entries.map(e => e.seq)).toEqual([3, 4, 5]);
  expect(readServerLogs({ logs: source() }, { contains: "db LOCK" }).entries.map(e => e.seq)).toEqual([5]);
});

it("limit keeps the NEWEST matches and reports truncation", () => {
  const result = readServerLogs({ logs: source() }, { limit: 2 });
  expect(result.entries.map(e => e.seq)).toEqual([4, 5]);
  expect(result.matched).toBe(5);
  expect(result.truncated).toBe(true);
});

it("capturing false is passed through so an empty list is not read as no errors", () => {
  expect(readServerLogs({ logs: source([], false) })).toEqual({ entries: [], matched: 0, buffered: 0, truncated: false, capturing: false });
});

it("parse accepts tool JSON and HTTP query strings alike", () => {
  expect(parseServerLogFilters({ raw: { level: "error", sinceIso: "2026-10-05T12:00:00Z", contains: "x", limit: 5 } })).toEqual({ level: "error", sinceIso: "2026-10-05T12:00:00.000Z", contains: "x", limit: 5 });
  expect(parseServerLogFilters({ raw: { limit: "20", level: "" } })).toEqual({ level: undefined, sinceIso: undefined, contains: undefined, limit: 20 });
  expect(parseServerLogFilters({ raw: {} })).toEqual({ level: undefined, sinceIso: undefined, contains: undefined, limit: undefined });
});

it("parse rejects each unusable field with a message naming it", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ level: "fatal" }, "level must be one of debug, info, warn, error"],
    [{ sinceIso: "yesterday" }, "sinceIso must be an ISO-8601 date-time, e.g. 2026-10-05T12:00:00Z"],
    [{ contains: "x".repeat(201) }, "contains must be a string of at most 200 characters"],
    [{ contains: 5 }, "contains must be a string of at most 200 characters"],
    [{ limit: 0 }, "limit must be an integer from 1 to 500"],
    [{ limit: 501 }, "limit must be an integer from 1 to 500"],
    [{ limit: "2.5" }, "limit must be an integer from 1 to 500"],
  ];
  for (const [raw, message] of cases) {
    expect(() => parseServerLogFilters({ raw }), JSON.stringify(raw)).toThrow(new ServerLogFilterError({ message }));
    expect(() => parseServerLogFilters({ raw }), JSON.stringify(raw)).toThrow(ServerLogFilterError);
  }
});

// Characterization (added with the move): the non-string arms of each parser, the error's name,
// the default limit, and the exported bounds hosts build their tool schema from.
it("parse rejects non-string level/sinceIso and a non-integer numeric limit", () => {
  expect(() => parseServerLogFilters({ raw: { level: 3 } })).toThrow("level must be one of debug, info, warn, error");
  expect(() => parseServerLogFilters({ raw: { sinceIso: 1_700_000_000_000 } })).toThrow("sinceIso must be an ISO-8601 date-time, e.g. 2026-10-05T12:00:00Z");
  expect(() => parseServerLogFilters({ raw: { limit: 2.5 } })).toThrow("limit must be an integer from 1 to 500");
  expect(() => parseServerLogFilters({ raw: { limit: true } })).toThrow("limit must be an integer from 1 to 500");
});

it("parse keeps a level exactly as sent and accepts the boundary limits", () => {
  expect(parseServerLogFilters({ raw: { level: "debug" } }).level).toBe("debug");
  expect(parseServerLogFilters({ raw: { limit: "1" } }).limit).toBe(1);
  expect(parseServerLogFilters({ raw: { limit: MAX_SERVER_LOG_LIMIT } }).limit).toBe(MAX_SERVER_LOG_LIMIT);
  expect(parseServerLogFilters({ raw: { contains: "x".repeat(MAX_CONTAINS_LENGTH) } }).contains).toHaveLength(MAX_CONTAINS_LENGTH);
});

it("ServerLogFilterError names itself so callers can map it to a 400 / model-facing input error", () => {
  const err = new ServerLogFilterError({ message: "limit must be an integer from 1 to 500" });
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("ServerLogFilterError");
  expect(err.message).toBe("limit must be an integer from 1 to 500");
});

it("without a limit returns at most the newest DEFAULT_SERVER_LOG_LIMIT lines", () => {
  const many = Array.from({ length: DEFAULT_SERVER_LOG_LIMIT + 3 }, (_, i) => ({ seq: i + 1, at: "2026-10-05T12:00:00.000Z", level: "info" as const, source: "server" as const, message: `line ${i + 1}` }));
  const result = readServerLogs({ logs: source(many) });
  expect(result.entries).toHaveLength(DEFAULT_SERVER_LOG_LIMIT);
  expect(result.entries[0]?.seq).toBe(4);
  expect(result).toMatchObject({ matched: DEFAULT_SERVER_LOG_LIMIT + 3, buffered: DEFAULT_SERVER_LOG_LIMIT + 3, truncated: true });
});

it("combines level, sinceIso and contains as an AND", () => {
  const result = readServerLogs({ logs: source() }, { level: "warn", sinceIso: "2026-10-05T12:00:04.000Z", contains: "route" });
  expect(result.entries.map(e => e.seq)).toEqual([4]);
  expect(result.matched).toBe(1);
});

it("exports the level vocabulary in severity order with the documented bounds", () => {
  expect(SERVER_LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
  expect([DEFAULT_SERVER_LOG_LIMIT, MAX_SERVER_LOG_LIMIT, MAX_CONTAINS_LENGTH]).toEqual([100, 500, 200]);
});
