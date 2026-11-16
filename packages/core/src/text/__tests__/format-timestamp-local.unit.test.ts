import { afterAll, beforeAll, expect, test } from "vitest";

import { formatRelativeMinutesAgo, formatTimestamp } from "../format-timestamp.js";

// Fixed viewer zone, independent of the server's UTC timestamps and the developer's machine.
// Run with TZ=America/Los_Angeles as well; restore env for other suites sharing this worker.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

test("D-06: the UTC Updated value is the viewer's previous evening in PDT", () => {
  expect(formatTimestamp({ iso: "2026-10-07T03:28:00.000Z" }, { timeZone: "local" })).toBe("2026-10-06 20:28");
});

test("converts explicit offsets rather than dropping their suffix", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30:45+05:30" }, { timeZone: "local" })).toBe("2026-07-31 22:00");
});

test("observes winter PST and a year boundary", () => {
  expect(formatTimestamp({ iso: "2027-01-01T03:28:00.000Z" }, { timeZone: "local" })).toBe("2026-12-31 19:28");
});

test("the DST jump skips the missing local hour", () => {
  expect(formatTimestamp({ iso: "2026-03-08T09:59:00Z" }, { timeZone: "local" })).toBe("2026-03-08 01:59");
  expect(formatTimestamp({ iso: "2026-03-08T10:00:00Z" }, { timeZone: "local" })).toBe("2026-03-08 03:00");
});

test("zone-less ISO text is already local wall time", () => {
  expect(formatTimestamp({ iso: "2026-08-01T10:30" }, { timeZone: "local" })).toBe("2026-08-01 10:30");
});

test("invalid input remains visible", () => {
  expect(formatTimestamp({ iso: "invalid timestamp" }, { timeZone: "local" })).toBe("invalid timestamp");
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
