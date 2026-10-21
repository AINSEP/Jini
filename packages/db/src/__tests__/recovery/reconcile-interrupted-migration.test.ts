import assert from "node:assert/strict";
import { test } from "vitest";

import { reconcileInterruptedMigrationOnBoot, type SiteServeStatus } from "../../recovery/reconcile-interrupted-migration.js";

/** @file Boot-time crash reconciliation: a non-terminal migration run becomes a ledger row and a blocked site. */

function harness(nonTerminal: { id: string; status: string } | null) {
  const events: unknown[] = [];
  return {
    events,
    required: {
      siteId: "site",
      migrationRuns: {
        findNonTerminalForSite: async (siteId: string) => {
          events.push(["find", siteId]);
          return nonTerminal;
        },
        markResolved: async () => {
          events.push(["resolved"]);
        },
      },
      ledger: {
        appendInterruptedRow: async (row: { siteId: string; migrationRunId: string }) => {
          events.push(["ledger", row]);
        },
      },
      siteStatus: {
        get: async (): Promise<SiteServeStatus> => "SERVING",
        set: async (siteId: string, status: SiteServeStatus) => {
          events.push(["status", siteId, status]);
        },
      },
    },
  };
}

test("a clean boot is not blocked and writes nothing", async () => {
  const h = harness(null);
  assert.deepEqual(await reconcileInterruptedMigrationOnBoot(h.required), { blocked: false });
  assert.deepEqual(h.events, [["find", "site"]]);
});

test("a crashed migration run is recorded in the ledger first, then blocks the site pending recovery", async () => {
  const h = harness({ id: "run-3", status: "DDL_IN_PROGRESS" });
  assert.deepEqual(await reconcileInterruptedMigrationOnBoot(h.required, {}), { blocked: true });
  assert.deepEqual(h.events, [
    ["find", "site"],
    ["ledger", { siteId: "site", migrationRunId: "run-3" }],
    ["status", "site", "BLOCKED_PENDING_RECOVERY"],
  ]);
});
