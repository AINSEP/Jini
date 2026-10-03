import assert from "node:assert/strict";
import { test } from "vitest";

import { listRestorePoints, type RestorePointRecord } from "../../tools/restore-points.js";

/**
 * @file design-spec.md §3.8/§4.8 backend-gap closure — `listRestorePoints` (this dispatch). Added
 * alongside the certified `createRestorePoint` in the same file without touching it — see this
 * file's own header for the split.
 */ 

function makeRow(overrides: Partial<RestorePointRecord> = {}): RestorePointRecord {
  return { artifactRef: "snapshot.db", id: "rp-1", trigger: "manual", costClass: "cheap", kind: "file-snapshot", watermarkAtCapture: 3, createdAt: "2026-07-15T00:00:00.000Z", ...overrides };
}

test("listRestorePoints: passes through whatever order/shape the port returns (the port owns query shape)", async () => {
  const rows = [makeRow({ id: "rp-2", createdAt: "2026-07-15T01:00:00.000Z" }), makeRow({ id: "rp-1" })];
  const repo = { list: async () => rows };

  const result = await listRestorePoints({ repo });

  assert.deepEqual(
    result.items.map((r) => r.id),
    ["rp-2", "rp-1"]
  );
});

test("listRestorePoints: a brand-new site with zero restore points returns an empty items array", async () => {
  const repo = { list: async () => [] as RestorePointRecord[] };

  const result = await listRestorePoints({ repo });

  assert.deepEqual(result.items, []);
});

test("listRestorePoints: renders a null watermarkAtCapture as null, never coerced to 0 (EC-02, ADR-045 §2)", async () => {
  const repo = { list: async () => [makeRow({ watermarkAtCapture: null })] };

  const result = await listRestorePoints({ repo });

  assert.equal(result.items[0]!.watermarkAtCapture, null);
});
