import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { DEFAULT_SITE_TIME_ZONE, formatDateLabel, formatIsoDate, normalizeTimeZone, resolveSiteTimeZoneSafely } from "../../date-label.js";

/**
 * @file Site-timezone date formatting (Bug D, 2026-10-22): a post published late in the evening in a
 * site west of UTC, or early in the morning in a site east of it, showed the neighbouring calendar
 * day because labels were formatted in the server process's zone (UTC). These pin the label to the
 * SITE's zone at both midnight boundaries.
 */

// 2026-03-04 07:30 UTC: still Mar 3 in Los Angeles (UTC-8), already Mar 4 in Tokyo (UTC+9).
const LA_LATE_EVENING = "2026-03-04T07:30:00.000Z";
// 2026-03-03 16:30 UTC: already Mar 4 in Tokyo (01:30), still Mar 3 in UTC and Los Angeles.
const TOKYO_EARLY_MORNING = "2026-03-03T16:30:00.000Z";

test("formatDateLabel: renders the calendar day of the site's zone, not the server's (America/Los_Angeles)", () => {
  assert.equal(formatDateLabel({ iso: LA_LATE_EVENING }, { timeZone: "America/Los_Angeles" }), "Mar 3, 2026");
  assert.equal(formatDateLabel({ iso: LA_LATE_EVENING }, { timeZone: "UTC" }), "Mar 4, 2026");
});

test("formatDateLabel: renders the calendar day of the site's zone, not the server's (Asia/Tokyo)", () => {
  assert.equal(formatDateLabel({ iso: TOKYO_EARLY_MORNING }, { timeZone: "Asia/Tokyo" }), "Mar 4, 2026");
  assert.equal(formatDateLabel({ iso: TOKYO_EARLY_MORNING }, { timeZone: "America/Los_Angeles" }), "Mar 3, 2026");
});

test("formatDateLabel: no zone means UTC, and an invalid zone falls back to UTC rather than throwing", () => {
  assert.equal(formatDateLabel({ iso: TOKYO_EARLY_MORNING }), "Mar 3, 2026");
  assert.equal(formatDateLabel({ iso: TOKYO_EARLY_MORNING }, { timeZone: "Not/A_Zone" }), "Mar 3, 2026");
});

test("formatDateLabel: a malformed timestamp degrades to the raw string, never 'Invalid Date'", () => {
  assert.equal(formatDateLabel({ iso: "not-a-date" }, { timeZone: "Asia/Tokyo" }), "not-a-date");
});

test("formatIsoDate: YYYY-MM-DD in the site's zone at both midnight boundaries, UTC by default", () => {
  assert.equal(formatIsoDate({ iso: LA_LATE_EVENING }, { timeZone: "America/Los_Angeles" }), "2026-03-03");
  assert.equal(formatIsoDate({ iso: TOKYO_EARLY_MORNING }, { timeZone: "Asia/Tokyo" }), "2026-03-04");
  assert.equal(formatIsoDate({ iso: LA_LATE_EVENING }), "2026-03-04");
  assert.equal(formatIsoDate({ iso: LA_LATE_EVENING }, { timeZone: "Mars/Olympus" }), "2026-03-04");
});

test("formatIsoDate: a malformed timestamp keeps the old first-ten-characters behavior", () => {
  assert.equal(formatIsoDate({ iso: "garbage-value" }, { timeZone: "Asia/Tokyo" }), "garbage-va");
});

test("normalizeTimeZone: keeps a valid IANA zone, maps anything else to UTC", () => {
  assert.equal(DEFAULT_SITE_TIME_ZONE, "UTC");
  assert.equal(normalizeTimeZone({ timeZone: "Asia/Tokyo" }), "Asia/Tokyo");
  assert.equal(normalizeTimeZone({ timeZone: " America/Los_Angeles " }), "America/Los_Angeles");
  assert.equal(normalizeTimeZone({ timeZone: "Not/A_Zone" }), "UTC");
  assert.equal(normalizeTimeZone({ timeZone: "" }), "UTC");
  assert.equal(normalizeTimeZone({ timeZone: 42 }), "UTC");
  assert.equal(normalizeTimeZone({ timeZone: undefined }), "UTC");
});

test("resolveSiteTimeZoneSafely: reads the port, normalizes it, and degrades to UTC when absent or failing", async () => {
  const ws = { workspaceId: "ws-1" };
  const seen: string[] = [];
  const port = { resolveTimeZone: async ({ workspaceId }: { workspaceId: string }) => (seen.push(workspaceId), "Asia/Tokyo") };
  assert.equal(await resolveSiteTimeZoneSafely(ws, { siteTimeZone: port }), "Asia/Tokyo");
  assert.deepEqual(seen, ["ws-1"]);
  assert.equal(await resolveSiteTimeZoneSafely(ws, { siteTimeZone: { resolveTimeZone: async () => "Bogus/Zone" } }), "UTC");
  assert.equal(await resolveSiteTimeZoneSafely(ws, { siteTimeZone: { resolveTimeZone: async () => { throw new Error("db down"); } } }), "UTC");
  assert.equal(await resolveSiteTimeZoneSafely(ws), "UTC");
});
