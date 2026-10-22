import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveDeepLinkContext } from "../../recovery/deep-link.js";
import { computeDisclosure } from "../../recovery/disclosure.js";
import { AlwaysUnavailableWatermarkSource, RestorePointDeepLinkLookup } from "../../recovery/lookup-adapters.js";
import type { RestorePointRecord } from "../../tools/restore-points.js";

/** @file The disclosed stand-in watermark source (never claims a baseline) and the real restore-points lookup. */

function point(id: string, createdAt: string): RestorePointRecord {
  return { id, trigger: "manual", costClass: "cheap", kind: "sqlite-file", watermarkAtCapture: null, createdAt, artifactRef: `/snapshots/${id}.db` };
}

test("the stand-in watermark source reports no baseline and no counts, so every covered count is unknown, never 0", async () => {
  const source = new AlwaysUnavailableWatermarkSource();
  assert.deepEqual(await source.getBaseline(), { available: false });
  assert.deepEqual(await source.getCategoryCounts(), {});

  const disclosure = await computeDisclosure({ deps: { watermarkSource: source, coveredCategories: ["pages"] }, input: { restorePointId: "rp1" } });
  assert.deepEqual(disclosure, { partial: true, watermarkBaselineAvailable: false, counts: { pages: "unknown" } });
});

test("the restore-points lookup finds a point by id and reports its creation time as its capture time", async () => {
  let lists = 0;
  const lookup = new RestorePointDeepLinkLookup({
    list: async () => {
      lists += 1;
      return [point("rp1", "2026-09-01T00:00:00.000Z"), point("rp2", "2026-09-02T00:00:00.000Z")];
    },
  });

  assert.deepEqual(await lookup.findRestorePointById("rp2"), { restorePointId: "rp2", capturedAt: "2026-09-02T00:00:00.000Z" });
  assert.equal(await lookup.findRestorePointById("rp-pruned"), null);
  assert.equal(lists, 2, "every lookup re-reads the list; nothing is cached");
});

test("through the deep-link resolver, a pruned point is not found even though the envelope names it", async () => {
  const lookup = new RestorePointDeepLinkLookup({ list: async () => [point("rp1", "2026-09-01T00:00:00.000Z")] });
  const envelope = { v: 1, correlationId: "c", siteId: "site", ledgerEventId: null, restorePointId: "rp-pruned", drift: "none", intent: "view", issuedAt: "x" };

  const resolved = await resolveDeepLinkContext({ deps: { lookup }, input: { principalId: "u", principalKind: "user", envelope } });
  assert.deepEqual(resolved, { found: false, restorePoint: null });
});
