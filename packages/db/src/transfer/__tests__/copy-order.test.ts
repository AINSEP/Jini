import assert from "node:assert/strict";
import { test } from "vitest";
import { TableCopyOrderCycleError, topologicalTableCopyOrder, type TableCopyDependency } from "../copy-order.js";

/** Host FK edges also carry SQL table names; the order function reads only the dependency fields. */
type ForeignKeyEdge = TableCopyDependency & { readonly fromSqlTableName: string; readonly toSqlTableName: string };

test("topologicalTableCopyOrder orders every referenced table before every table that references it (synthetic DAG, not the real schema)", () => {
  const edges: ForeignKeyEdge[] = [
    { fromExportName: "c", fromSqlTableName: "c", toExportName: "b", toSqlTableName: "b", selfReferencing: false },
    { fromExportName: "b", fromSqlTableName: "b", toExportName: "a", toSqlTableName: "a", selfReferencing: false },
  ];
  const order = topologicalTableCopyOrder({ allExportNames: ["c", "b", "a", "d"], edges });
  assert.deepEqual(new Set(order), new Set(["a", "b", "c", "d"]));
  assert.ok(order.indexOf("a") < order.indexOf("b"), "a (referenced by b) must come before b");
  assert.ok(order.indexOf("b") < order.indexOf("c"), "b (referenced by c) must come before c");
});

test("topologicalTableCopyOrder throws TableCopyOrderCycleError for a cycle across different tables (synthetic — the real schema has none today, proven below)", () => {
  const edges: ForeignKeyEdge[] = [
    { fromExportName: "a", fromSqlTableName: "a", toExportName: "b", toSqlTableName: "b", selfReferencing: false },
    { fromExportName: "b", fromSqlTableName: "b", toExportName: "c", toSqlTableName: "c", selfReferencing: false },
    { fromExportName: "c", fromSqlTableName: "c", toExportName: "a", toSqlTableName: "a", selfReferencing: false },
  ];
  assert.throws(
    () => topologicalTableCopyOrder({ allExportNames: ["a", "b", "c"], edges }),
    (err: unknown) => {
      assert.ok(err instanceof TableCopyOrderCycleError, "must throw TableCopyOrderCycleError specifically");
      assert.deepEqual(new Set((err as TableCopyOrderCycleError).stuckExportNames), new Set(["a", "b", "c"]));
      return true;
    }
  );
});

test("topologicalTableCopyOrder excludes self-referencing edges from the ordering graph — a table cannot be sequenced before itself, but still appears exactly once", () => {
  const edges: ForeignKeyEdge[] = [
    { fromExportName: "tree", fromSqlTableName: "tree", toExportName: "tree", toSqlTableName: "tree", selfReferencing: true },
  ];
  const order = topologicalTableCopyOrder({ allExportNames: ["tree", "other"], edges });
  assert.deepEqual(new Set(order), new Set(["tree", "other"]));
  assert.equal(order.filter((n) => n === "tree").length, 1, "a self-referencing table must appear exactly once, not be dropped or duplicated");
});

/**
 * Characterization test (pre-refactor pin): `topologicalTableCopyOrder` re-sorts a table into the
 * READY QUEUE the moment its in-degree hits zero, rather than sorting once up front and then
 * appending newly-ready tables to the end. This distinguishes it from a naive FIFO queue — those two
 * strategies diverge on this exact input. Initial ready set (in-degree 0) is {a, m, z}, alphabetically
 * a, m, z. Processing "a" makes "b" ready. A "sort once, append to end" queue would process the
 * already-ready m, z before ever seeing b, yielding [a, m, z, b]. This function instead re-inserts
 * "b" into its alphabetically-sorted position among the still-ready {m, z}, yielding [a, b, m, z] —
 * "process alphabetically among currently-ready tables" holds at every step, not just the first.
 */
test("topologicalTableCopyOrder re-sorts a newly-ready table into its alphabetical position among already-ready tables, not just appended to the end (pins the insert-on-ready tie-break)", () => {
  const edges: ForeignKeyEdge[] = [
    { fromExportName: "b", fromSqlTableName: "b", toExportName: "a", toSqlTableName: "a", selfReferencing: false },
  ];
  const order = topologicalTableCopyOrder({ allExportNames: ["a", "m", "z", "b"], edges });
  assert.deepEqual(order, ["a", "b", "m", "z"]);
});

test("topologicalTableCopyOrder rejects either unnamed edge endpoint", () => {
  const pairs: ReadonlyArray<readonly [string, string]> = [["missing", "named"], ["named", "missing"]];
  for (const [from, to] of pairs) {
    const edge = { fromExportName: from, fromSqlTableName: from, toExportName: to, toSqlTableName: to, selfReferencing: false };
    assert.throws(() => topologicalTableCopyOrder({ allExportNames: ["named"], edges: [edge] }), { message: `edge references "${from}" -> "${to}", but allExportNames does not list both — topologicalTableCopyOrder() requires every edge endpoint to be one of the named tables.` });
  }
});

test("topologicalTableCopyOrder counts two FKs to the same target once (duplicate edges do not fake a cycle)", () => {
  const edges: ForeignKeyEdge[] = [
    { fromExportName: "b", fromSqlTableName: "b", toExportName: "a", toSqlTableName: "a", selfReferencing: false },
    { fromExportName: "b", fromSqlTableName: "b", toExportName: "a", toSqlTableName: "a", selfReferencing: false },
  ];
  assert.deepEqual(topologicalTableCopyOrder({ allExportNames: ["b", "a"], edges }), ["a", "b"]);
});
