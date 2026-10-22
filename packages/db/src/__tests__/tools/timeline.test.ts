import assert from "node:assert/strict";
import { test } from "vitest";

import { getTimeline, type LedgerReadPort } from "../../tools/timeline.js";

/**
 * @file the Timeline read model.
 *
 * Assumed seam design:
 *
 * ```ts
 * export interface LedgerRow {
 * id: string; kind: string; createdAt: string; restorePointId: string | null; outcome: string;
 * }
 * export interface LedgerReadPort {
 * query(filter: { kind?: string; fromDate?: string; toDate?: string; outcome?: string; cursor?: string | null; limit: number })
 * Promise<{ items: LedgerRow[]; nextCursor: string | null }>;
 * }
 * export async function getTimeline(
 * required: { ledger: LedgerReadPort; filter?: { kind?: string; fromDate?: string; toDate?: string; outcome?: string; cursor?: string; limit?: number } },
 * optional?: {}
 * ): Promise<{ items: LedgerRow[]; nextCursor: string | null }>; throws ValidationError if limit > 200
 * ```
 * See docs/decisions/DR-001-bounded-operational-timeline.md.
 */

function fakeLedger(rows: Array<{ id: string; createdAt: string; kind?: string; restorePointId?: string | null; outcome?: string }>) {
  return {
    async query(filter: { kind?: string | undefined; limit: number }) {
      const filtered = filter.kind ? rows.filter((r) => r.kind === filter.kind) : rows;
      return {
        items: filtered.slice(0, filter.limit).map((r) => ({
          id: r.id,
          kind: r.kind ?? "core.migration",
          createdAt: r.createdAt,
          restorePointId: r.restorePointId ?? "rp-1",
          outcome: r.outcome ?? "success",
        })),
        nextCursor: null,
      };
    },
  };
}

test("AC-01: getTimeline returns rows with restore-point linkage present", async () => {
  const ledger = fakeLedger([{ id: "row-1", createdAt: "2026-07-15T00:00:00.000Z", restorePointId: "rp-9" }]);
  const result = await getTimeline({ ledger });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.restorePointId, "rp-9");
});

test("AC-04 / REQ-04: getTimeline with a kind filter returns only matching rows", async () => {
  const ledger = fakeLedger([
    { id: "row-1", createdAt: "2026-07-15T00:00:00.000Z", kind: "core.migration" },
    { id: "row-2", createdAt: "2026-07-15T00:01:00.000Z", kind: "index.provision" },
  ]);
  const result = await getTimeline({ ledger, filter: { kind: "index.provision" } });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.id, "row-2");
});

test("getTimeline returns an empty items array (never an error) when no rows match", async () => {
  const ledger = fakeLedger([]);
  const result = await getTimeline({ ledger, filter: { kind: "template.upgrade" } });
  assert.deepEqual(result.items, []);
});

test("REQ-04 / AC-34-adjacent: getTimeline rejects a limit above 200 (no raw SQL / unbounded query surface)", async () => {
  const ledger = fakeLedger([]);
  await assert.rejects(getTimeline({ ledger, filter: { limit: 500 } }));
  assert.deepEqual(await getTimeline({ ledger, filter: { limit: 200 } }), { items: [], nextCursor: null });
  await assert.rejects(getTimeline({ ledger, filter: { limit: 201 } }), { name: "TimelineValidationError" });
});

test("getTimeline forwards all filters, defaults to 50, and preserves pagination results", async () => {
  const queries: Parameters<LedgerReadPort["query"]>[0][] = [];
  const page = { items: [{ id: "row-page", kind: "core.migration", createdAt: "2026-07-15T00:00:00.000Z", restorePointId: "rp-page", outcome: "failure" }], nextCursor: "next-page" };
  const ledger: LedgerReadPort = { query: async (filter) => { queries.push(filter); return page; } };
  const filter = { kind: "core.migration", fromDate: "2026-07-01", toDate: "2026-07-31", outcome: "failure", cursor: "previous-page" };
  assert.deepEqual(await getTimeline({ ledger, filter }), page);
  assert.deepEqual(await getTimeline({ ledger }), page);
  assert.deepEqual(await getTimeline({ ledger, filter: { ...filter, limit: 200 } }), page);
  assert.deepEqual(queries, [{ ...filter, limit: 50 }, { limit: 50 }, { ...filter, limit: 200 }]);
});

test("AC-05 / REQ-05: this module exposes no raw-row-edit, SQL-console, or DB-first-mode function — only getTimeline is exported", async () => {
  const timelineModule = await import("../../tools/timeline.js");
  const exportedNames = Object.keys(timelineModule);
  const disallowed = exportedNames.filter((name) => /rawQuery|sqlConsole|editRow|runSql/i.test(name));
  assert.deepEqual(disallowed, [], "AC-05: no raw-SQL/edit/DB-first-mode surface may exist in this module");
});

test("timeline cap error is descriptive without a specification prefix and never queries the ledger", async () => {
  let queried = false;
  const ledger: LedgerReadPort = { query: async () => { queried = true; return { items: [], nextCursor: null }; } };
  await assert.rejects(getTimeline({ ledger, filter: { limit: 201 } }), {
    name: "TimelineValidationError", message: "requested limit 201 exceeds the server cap of 200",
  });
  assert.equal(queried, false);
});

// REGRESSION (fix-plan C6a): a limit of 0 or 2.5 used to reach the ledger (an empty page, or a
// fractional SQL LIMIT); the admin route reads `?limit=` with Number(), so "abc" arrived as NaN.
test("getTimeline refuses a non-integer or non-positive limit without querying the ledger", async () => {
  let queried = false;
  const ledger: LedgerReadPort = { query: async () => { queried = true; return { items: [], nextCursor: null }; } };
  for (const limit of [0, -1, 2.5, Number.NaN]) {
    await assert.rejects(getTimeline({ ledger, filter: { limit } }), {
      name: "TimelineValidationError", message: "'limit' must be an integer between 1 and 200",
    });
  }
  assert.equal(queried, false);
});
