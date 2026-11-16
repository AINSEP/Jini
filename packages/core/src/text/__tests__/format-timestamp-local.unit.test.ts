import { afterAll, beforeAll, expect, test } from "vitest";

import { formatRelativeMinutesAgo, formatTimestamp } from "../format-timestamp.js";

// The viewer's zone is an explicit input, so the host process zone is set to an unrelated one:
// any leak of ambient state would render Tokyo time instead of the requested Los Angeles time.
const LA = { viewerTimeZone: "America/Los_Angeles" };
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "Asia/Tokyo"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

test("same arguments render the same string whatever the host process timezone", () => {
  const rendered: string[] = [];
  for (const hostZone of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Europe/Berlin"]) {
    process.env.TZ = hostZone;
    rendered.push(formatTimestamp({ iso: "2026-10-07T03:28:00.000Z" }, LA));
    rendered.push(formatTimestamp({ iso: "2026-08-01T10:30" }, LA));
  }
  process.env.TZ = "Asia/Tokyo";
  expect(new Set(rendered)).toEqual(new Set(["2026-10-06 20:28", "2026-08-01 10:30"]));
});

test("a different viewer zone gives that zone's wall time", () => {
  expect(formatTimestamp({ iso: "2026-10-07T03:28:00.000Z" }, { viewerTimeZone: "UTC" })).toBe("2026-10-07 03:28");
  expect(formatTimestamp({ iso: "2026-10-07T03:28:00.000Z" }, { viewerTimeZone: "Asia/Kolkata" })).toBe("2026-10-07 08:58");
});

test("midnight renders as 00, never 24", () => {
  expect(formatTimestamp({ iso: "2026-10-07T07:00:00Z" }, LA)).toBe("2026-10-07 00:00");
});

test("an ISO date or non-ISO text without a zone is not reinterpreted in the host zone", () => {
  expect(formatTimestamp({ iso: "2026-10-07" }, LA)).toBe("2026-10-06 17:00");
  expect(formatTimestamp({ iso: "Oct 7 2026 03:28" }, LA)).toBe("Oct 7 2026 03:28");
});

test("D-06: the UTC Updated value is the viewer's previous evening in PDT", () => {
  expect(formatTimestamp({ iso: "2026-10-07T03:28:00.000Z" }, LA)).toBe("2026-10-06 20:28");
});

test("converts explicit offsets rather than dropping their suffix", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30:45+05:30" }, LA)).toBe("2026-07-31 22:00");
});

test("observes winter PST and a year boundary", () => {
  expect(formatTimestamp({ iso: "2027-01-01T03:28:00.000Z" }, LA)).toBe("2026-12-31 19:28");
});

test("the DST jump skips the missing local hour", () => {
  expect(formatTimestamp({ iso: "2026-03-08T09:59:00Z" }, LA)).toBe("2026-03-08 01:59");
  expect(formatTimestamp({ iso: "2026-03-08T10:00:00Z" }, LA)).toBe("2026-03-08 03:00");
});

test("zone-less ISO text is already local wall time", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30" }, LA)).toBe("2026-08-01 10:30");
});

test("invalid input remains visible", () => {
  expect(formatTimestamp({ iso: "invalid timestamp" }, LA)).toBe("invalid timestamp");
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
