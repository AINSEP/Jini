import { describe, expect, it } from "vitest";
import { openSqliteSnapshotSource, type SnapshotClient } from "../sqlite-source.js";

/** L2 §4 sqlite-source: the WAL→rollback header patch (bytes 18/19) on a COPY only, and the
 *  CREATE VIRTUAL TABLE classifier's anchoring/whitespace/case, through an injected opener fake. */
function header(b18: number, b19: number): Buffer {
  const bytes = Buffer.alloc(32, 7);
  bytes[18] = b18; bytes[19] = b19;
  return bytes;
}
function opened(bytes: Buffer) {
  let seen: Buffer | undefined;
  const client: SnapshotClient = { prepare: () => { throw new Error("unused"); }, close: () => undefined };
  openSqliteSnapshotSource({ bytes }, { open: (b) => { seen = b; return client; } });
  return seen!;
}

describe("WAL header patch", () => {
  it.each([[2, 2], [2, 1], [1, 2]])("bytes18/19 = %i/%i are patched to 1/1 on a copy", (a, b) => {
    const bytes = header(a, b);
    const seen = opened(bytes);
    expect([seen[18], seen[19]]).toEqual([1, 1]);
    expect(seen).not.toBe(bytes);
    expect([bytes[18], bytes[19]]).toEqual([a, b]);
    expect(seen.subarray(0, 18)).toEqual(bytes.subarray(0, 18));
    expect(seen.subarray(20)).toEqual(bytes.subarray(20));
  });
  it("a rollback-journal header (1/1) is passed through untouched (same buffer)", () => {
    const bytes = header(1, 1);
    expect(opened(bytes)).toBe(bytes);
  });
});

describe("virtual table classification", () => {
  function layoutFor(sql: string | null) {
    const client = {
      prepare: (q: string) => ({
        get: () => (q.startsWith("SELECT sql") ? { sql } : undefined),
        all: () => [],
        raw() { return this; }, safeIntegers() { return this; }, iterate: () => [],
      }),
      close: () => undefined,
    } as unknown as SnapshotClient;
    return openSqliteSnapshotSource({ bytes: header(1, 1) }, { open: () => client }).layout("t");
  }
  it.each(["CREATE VIRTUAL TABLE t USING fts5(x)", "  create   virtual\ttable t USING fts5(x)", "\nCREATE VIRTUAL TABLE t"])("%j is virtual", (sql) => {
    expect(layoutFor(sql)?.virtual).toBe(true);
  });
  it.each(["CREATE TABLE t (virtual TEXT)", "CREATE TABLE virtual_table (x)", "-- CREATE VIRTUAL TABLE\nCREATE TABLE t(x)", "CREATE VIRTUALTABLE t", null])("%j is not virtual", (sql) => {
    expect(layoutFor(sql)?.virtual).toBe(false);
  });
});
