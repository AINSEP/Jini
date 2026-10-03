import { expect, test } from "vitest";

import { formatRelativeMinutesAgo, formatTimestamp } from "../format-timestamp";

/**
 * @file `formatTimestamp` — pins the exact output the ~11 call sites this consolidates
 * (`x.slice(0, 16).replace("T", " ")`, audit cross-cutting finding #4) already produced, so the
 * migration to a shared helper is provably a no-op on rendered output.
 */

test("formats a standard ISO timestamp as 'YYYY-MM-DD HH:MM'", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30:00.000Z" })).toBe("2026-08-01 10:30");
});

test("trailing seconds/milliseconds/zone suffix are dropped, not just the Z", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30:45+05:30" })).toBe("2026-08-01 10:30");
});

test("a timestamp with no sub-minute precision at all is unaffected", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30" })).toBe("2026-08-01 10:30");
});

const NOW = new Date("2026-09-06T00:10:00.000Z").getTime();

test("formatRelativeMinutesAgo: under a minute reads 'less than a minute ago'", () => {
  expect(formatRelativeMinutesAgo({ iso: "2026-09-06T00:09:45.000Z", nowMs: NOW })).toBe("less than a minute ago");
});

test("formatRelativeMinutesAgo: exactly one minute is singular", () => {
  expect(formatRelativeMinutesAgo({ iso: "2026-09-06T00:09:00.000Z", nowMs: NOW })).toBe("1 minute ago");
});

test("formatRelativeMinutesAgo: several minutes is plural", () => {
  expect(formatRelativeMinutesAgo({ iso: "2026-09-06T00:03:00.000Z", nowMs: NOW })).toBe("7 minutes ago");
});

test("formatRelativeMinutesAgo: a timestamp at or after 'now' never goes negative", () => {
  expect(formatRelativeMinutesAgo({ iso: "2026-09-06T00:15:00.000Z", nowMs: NOW })).toBe("less than a minute ago");
});
