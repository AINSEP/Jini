import assert from "node:assert/strict";
import { test } from "vitest";

import { computeDisclosure, type WatermarkBaseline } from "../../recovery/disclosure.js";

/**
 * @file INV-05: only `coveredCategories` are ever disclosed, a usable baseline gives counts (a
 * missing one is 0), and an unusable baseline gives "unknown" for every covered category, never 0.
 */

const covered = ["pages", "media"] as const;

function source(baseline: WatermarkBaseline, counts: Record<string, number>) {
  let countReads = 0;
  return {
    reads: () => countReads,
    port: {
      getBaseline: async () => baseline,
      getCategoryCounts: async () => {
        countReads += 1;
        return counts;
      },
    },
  };
}

const run = (watermarkSource: ReturnType<typeof source>["port"]) =>
  computeDisclosure({ deps: { watermarkSource, coveredCategories: covered }, input: { restorePointId: "rp1" } });

test("a usable baseline discloses covered counts only, a missing covered count as 0, never an uncovered category", async () => {
  const counts = source({ available: true, watermarkAtCapture: 10, currentWatermark: 14 }, { pages: 3, entries: 9 });

  assert.deepEqual(await run(counts.port), { partial: true, watermarkBaselineAvailable: true, counts: { pages: 3, media: 0 } });
  assert.equal(counts.reads(), 1);
});

test("a baseline captured at watermark 0 is still usable (0 is a value, not a missing one)", async () => {
  const counts = source({ available: true, watermarkAtCapture: 0 }, { pages: 1, media: 2 });
  assert.deepEqual((await run(counts.port)).counts, { pages: 1, media: 2 });
});

test("an unavailable baseline, or a restore point from before the watermark column, renders every covered count as unknown", async () => {
  const unusable: Array<[WatermarkBaseline, boolean]> = [
    [{ available: false }, false],
    [{ available: true, watermarkAtCapture: null }, true],
    [{ available: true }, true],
  ];
  for (const [baseline, available] of unusable) {
    const counts = source(baseline, { pages: 5, media: 5 });
    const result = await computeDisclosure(
      { deps: { watermarkSource: counts.port, coveredCategories: covered }, input: { restorePointId: "rp1" } },
      {}
    );
    assert.deepEqual(result, { partial: true, watermarkBaselineAvailable: available, counts: { pages: "unknown", media: "unknown" } });
    assert.equal(counts.reads(), 0, "counts are never read without a usable baseline");
  }
});
