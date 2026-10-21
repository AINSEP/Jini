import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateBootMigrationPolicy, UnresolvedInterruptedMigrationError } from "../../recovery/evaluate-boot-migration-policy.js";
import type { SiteServeStatus } from "../../recovery/reconcile-interrupted-migration.js";

/** @file The cost-gated serve-time auto-migrate: cheap migrates, anything else boots PENDING_MIGRATION; an unresolved crash refuses both. */

function harness(nonTerminal: { id: string; status: string } | null, autoMigrate: () => Promise<void> = async () => {}) {
  const events: string[] = [];
  const statuses = new Map<string, SiteServeStatus>();
  return {
    events,
    statuses,
    required: (costClass: "cheap" | "expensive" | "unavailable") => ({
      siteId: "site",
      costClass,
      siteStatus: {
        get: async (siteId: string) => statuses.get(siteId) ?? "SERVING",
        set: async (siteId: string, status: SiteServeStatus) => {
          events.push(`status:${status}`);
          statuses.set(siteId, status);
        },
      },
      migrationRuns: {
        findNonTerminalForSite: async (siteId: string) => {
          events.push(`find:${siteId}`);
          return nonTerminal;
        },
        markResolved: async () => {
          events.push("resolved");
        },
      },
      runAutoMigrate: async () => {
        events.push("auto-migrate");
        await autoMigrate();
      },
    }),
  };
}

test("a cheap site auto-migrates and keeps its serving status", async () => {
  const h = harness(null);
  await evaluateBootMigrationPolicy(h.required("cheap"));
  assert.deepEqual(h.events, ["find:site", "auto-migrate"]);
  assert.equal(h.statuses.size, 0);
});

test("an expensive or unavailable site never auto-migrates; it boots PENDING_MIGRATION", async () => {
  for (const costClass of ["expensive", "unavailable"] as const) {
    const h = harness(null);
    await evaluateBootMigrationPolicy(h.required(costClass), {});
    assert.deepEqual(h.events, ["find:site", "status:PENDING_MIGRATION"]);
    assert.equal(h.statuses.get("site"), "PENDING_MIGRATION");
  }
});

test("a still non-terminal migration run refuses the policy before any migrate or status change", async () => {
  const h = harness({ id: "run-7", status: "DDL_IN_PROGRESS" });
  await assert.rejects(evaluateBootMigrationPolicy(h.required("cheap")), (error: unknown) => {
    assert.ok(error instanceof UnresolvedInterruptedMigrationError);
    assert.equal(error.name, "UnresolvedInterruptedMigrationError");
    assert.equal(
      error.message,
      "refusing to evaluate boot migration policy for site 'site' while migration_runs row 'run-7' is still non-terminal"
    );
    return true;
  });
  assert.deepEqual(h.events, ["find:site"]);
});

test("an auto-migrate failure propagates without marking the site pending", async () => {
  const failure = new Error("migration step failed");
  const h = harness(null, async () => {
    throw failure;
  });
  await assert.rejects(evaluateBootMigrationPolicy(h.required("cheap")), (error: unknown) => error === failure);
  assert.equal(h.statuses.size, 0);
});
