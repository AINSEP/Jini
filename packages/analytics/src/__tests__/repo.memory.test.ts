import assert from "node:assert/strict";
import { test } from "vitest";

import { LocalBufferSink } from "../repo.memory.js";
import type { NormalizedHit } from "../types.js";

/**
 * @file Unit tests for `LocalBufferSink.list()` — the admin "recent hits" read accessor.
 *
 * Covers the ordinary case plus the adversarial/bounds cases the resource-bounds pre-check calls
 * for: an over-cap requested limit, and non-finite (`NaN`, negative, zero) limit input, since this
 * accessor is what a caller-controlled `?limit=` query param feeds into (see
 * `routes/admin/analytics/recent-hits.ts`).
 */

function makeHit(path: string, occurredAt: string): NormalizedHit {
  return {
    workspaceId: "workspace-1",
    occurredAt,
    kind: "pageview",
    path,
    referrerHost: null,
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    country: null,
    region: null,
    deviceClass: "desktop",
    browserFamily: "chrome",
    osFamily: "windows",
    visitorHash: "hash",
    sessionId: "session",
    eventName: null,
    eventProps: null,
  };
}

test("list() with no hits returns an empty array", async () => {
  const sink = new LocalBufferSink({});
  assert.deepEqual(await sink.list({}), []);
});

test("list() returns hits newest-first", async () => {
  const sink = new LocalBufferSink({});
  await sink.accept({ hit: makeHit("/a", "2026-07-10T12:00:00.000Z") });
  await sink.accept({ hit: makeHit("/b", "2026-07-10T12:01:00.000Z") });
  await sink.accept({ hit: makeHit("/c", "2026-07-10T12:02:00.000Z") });

  const result = await sink.list({});
  assert.deepEqual(result.map((h) => h.path), ["/c", "/b", "/a"]);
});

test("list() defaults to 50 rows when no limit is given", async () => {
  const sink = new LocalBufferSink({});
  for (let i = 0; i < 60; i += 1) {
    await sink.accept({ hit: makeHit(`/p${i}`, "2026-07-10T12:00:00.000Z") });
  }

  const result = await sink.list({});
  assert.equal(result.length, 50);
  assert.equal(result[0]!.path, "/p59"); // newest first
});

test("list() honors an explicit limit within bounds", async () => {
  const sink = new LocalBufferSink({});
  for (let i = 0; i < 10; i += 1) {
    await sink.accept({ hit: makeHit(`/p${i}`, "2026-07-10T12:00:00.000Z") });
  }

  assert.equal((await sink.list({}, { limit: 3 })).length, 3);
});

test("list() clamps a requested limit above the hard cap (500) instead of returning unbounded rows", async () => {
  const sink = new LocalBufferSink({});
  for (let i = 0; i < 600; i += 1) {
    await sink.accept({ hit: makeHit(`/p${i}`, "2026-07-10T12:00:00.000Z") });
  }

  assert.equal((await sink.list({}, { limit: 100000 })).length, 500);
});

test("list() clamps non-finite/invalid limit input to at least 1 rather than throwing or returning everything", async () => {
  const sink = new LocalBufferSink({});
  for (let i = 0; i < 5; i += 1) {
    await sink.accept({ hit: makeHit(`/p${i}`, "2026-07-10T12:00:00.000Z") });
  }

  assert.equal((await sink.list({}, { limit: Number.NaN })).length, 5); // NaN falls back to the default (50), capped by actual size
  assert.equal((await sink.list({}, { limit: -10 })).length, 1); // clamped up to the floor of 1
  assert.equal((await sink.list({}, { limit: 0 })).length, 1);
});

test("list() returns a defensive copy — mutating the result does not affect internal state", async () => {
  const sink = new LocalBufferSink({});
  await sink.accept({ hit: makeHit("/a", "2026-07-10T12:00:00.000Z") });

  const result = await sink.list({});
  result.pop();

  assert.equal((await sink.list({})).length, 1);
});
