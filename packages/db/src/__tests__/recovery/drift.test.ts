import assert from "node:assert/strict";
import { test } from "vitest";

import { getDriftStatus } from "../../recovery/drift.js";

/**
 * @file SPEC-017 C-102 / CIC U-002 / REQ-03 / AC-03 — drift classification, tag-identity-decisive.
 *
 * Assumed seam design:
 *
 * ```ts
 * export interface SchemaSnapshot { version: number; tag: string; }
 * export function getDriftStatus(
 *   required: { siteMeta: SchemaSnapshot; runtime: SchemaSnapshot },
 *   optional?: {}
 * ): "in-sync" | "ahead" | "diverged" | "behind";
 * ```
 *
 * CIC U-002-B1/ORD1: tag-identity comparison is evaluated first and is UNCONDITIONALLY decisive;
 * version-index comparison is used only to disambiguate ahead/behind once tags already match.
 */

test("in-sync: identical version and tag", () => {
  const status = getDriftStatus({ siteMeta: { version: 5, tag: "a" }, runtime: { version: 5, tag: "a" } });
  assert.equal(status, "in-sync");
});

test("ahead: site version index is higher than runtime, same tag lineage", () => {
  const status = getDriftStatus({ siteMeta: { version: 6, tag: "a" }, runtime: { version: 5, tag: "a" } });
  assert.equal(status, "ahead");
});

test("behind: site version index is lower than runtime, same tag lineage", () => {
  const status = getDriftStatus({ siteMeta: { version: 4, tag: "a" }, runtime: { version: 5, tag: "a" } });
  assert.equal(status, "behind");
});

test("U-002-B1 / U-002-ORD1 / AC-03: equal version index but DIFFERENT tag must classify as 'diverged', never 'in-sync' — the adversarial case a naive count-first implementation would misclassify", () => {
  const status = getDriftStatus({ siteMeta: { version: 5, tag: "lineage-a" }, runtime: { version: 5, tag: "lineage-b" } });
  assert.equal(status, "diverged", "tag mismatch at equal index is the exact case a version-index-first shortcut would silently misclassify as in-sync");
});

test("U-002-B1 (property): tag mismatch is decisive across every version-index relationship (equal, site-ahead, site-behind) — always 'diverged', never derived from index alone", () => {
  const indexRelationships: Array<[number, number]> = [
    [5, 5], // equal
    [6, 5], // site ahead by index
    [4, 5], // site behind by index
  ];

  for (const [siteVersion, runtimeVersion] of indexRelationships) {
    const status = getDriftStatus({
      siteMeta: { version: siteVersion, tag: "lineage-a" },
      runtime: { version: runtimeVersion, tag: "lineage-b" },
    });
    assert.equal(
      status,
      "diverged",
      `tag mismatch at siteVersion=${siteVersion}/runtimeVersion=${runtimeVersion} must always be 'diverged' regardless of index relationship`
    );
  }
});

test("getDriftStatus never throws, even for unusual (e.g. negative or zero) version values", () => {
  assert.doesNotThrow(() => getDriftStatus({ siteMeta: { version: 0, tag: "a" }, runtime: { version: 0, tag: "a" } }));
  for (const [site, runtime, expected] of [
    [0, 0, "in-sync"], [-1, -1, "in-sync"], [-1, 0, "behind"], [0, -1, "ahead"], [-2, -1, "behind"],
  ] as const) {
    assert.equal(getDriftStatus({ siteMeta: { version: site, tag: "a" }, runtime: { version: runtime, tag: "a" } }), expected);
    assert.equal(getDriftStatus({ siteMeta: { version: site, tag: "a" }, runtime: { version: runtime, tag: "b" } }), "diverged");
  }
});
