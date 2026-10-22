import assert from "node:assert/strict";
import { test } from "vitest";

import { type DegradedBannerCapabilities, type DegradedBannerKind, resolveDegradedBanner } from "../../recovery/degraded-banners.js";

/** @file The fixed primary-banner precedence: interrupted > pending > in-flight > cost-unavailable > no watermark baseline. */

const healthy: DegradedBannerCapabilities = {
  costClass: "cheap",
  operationInFlight: false,
  pendingMigration: false,
  migrationInterrupted: false,
  watermarkBaselineAvailable: true,
};

test("a healthy site shows no banner, whatever its (available) cost class", () => {
  assert.equal(resolveDegradedBanner({ capabilities: healthy }), null);
  assert.equal(resolveDegradedBanner({ capabilities: { ...healthy, costClass: "expensive" } }, {}), null);
});

test("each degraded condition alone selects its own banner and action", () => {
  const cases: Array<[Partial<DegradedBannerCapabilities>, DegradedBannerKind, string, RegExp]> = [
    [{ migrationInterrupted: true }, "migration-interrupted", "unblock-interrupted-migration", /interrupted mid-run/],
    [{ pendingMigration: true }, "pending-migration", "deep-link-to-database-migration", /Database Timeline's own migration ceremony/],
    [{ operationInFlight: true }, "operation-in-flight", "none", /already in progress/],
    [{ costClass: "unavailable" }, "cost-unavailable", "none", /No restore-point mechanism/],
    [{ watermarkBaselineAvailable: false }, "watermark-baseline-unavailable", "none", /marked "unknown"/],
  ];
  for (const [change, kind, actionKind, text] of cases) {
    const banner = resolveDegradedBanner({ capabilities: { ...healthy, ...change } });
    assert.equal(banner?.kind, kind);
    assert.equal(banner?.actionKind, actionKind);
    assert.match(banner?.accessibleText ?? "", text);
  }
});

test("the pending-migration banner never offers a restore action (restoring does not resolve schema drift)", () => {
  const banner = resolveDegradedBanner({ capabilities: { ...healthy, pendingMigration: true, costClass: "unavailable", operationInFlight: true } });
  assert.deepEqual([banner?.kind, banner?.actionKind], ["pending-migration", "deep-link-to-database-migration"]);
});

test("the watermark banner does not frame a permanent state as a transient one", () => {
  const banner = resolveDegradedBanner({ capabilities: { ...healthy, watermarkBaselineAvailable: false } });
  assert.doesNotMatch(banner?.accessibleText ?? "", /right now/);
});

test("across every combination of conditions, the highest-precedence one wins", () => {
  const precedence: Array<[DegradedBannerKind, (c: DegradedBannerCapabilities) => boolean]> = [
    ["migration-interrupted", (c) => c.migrationInterrupted],
    ["pending-migration", (c) => c.pendingMigration],
    ["operation-in-flight", (c) => c.operationInFlight],
    ["cost-unavailable", (c) => c.costClass === "unavailable"],
    ["watermark-baseline-unavailable", (c) => !c.watermarkBaselineAvailable],
  ];
  let combinations = 0;
  for (const costClass of ["cheap", "expensive", "unavailable"] as const)
    for (let bits = 0; bits < 16; bits += 1) {
      const capabilities: DegradedBannerCapabilities = {
        costClass,
        migrationInterrupted: (bits & 1) !== 0,
        pendingMigration: (bits & 2) !== 0,
        operationInFlight: (bits & 4) !== 0,
        watermarkBaselineAvailable: (bits & 8) === 0,
      };
      const expected = precedence.find(([, holds]) => holds(capabilities))?.[0] ?? null;
      assert.equal(resolveDegradedBanner({ capabilities })?.kind ?? null, expected, JSON.stringify(capabilities));
      combinations += 1;
    }
  assert.equal(combinations, 48);
});
