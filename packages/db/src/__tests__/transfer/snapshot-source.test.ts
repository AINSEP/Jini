import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { openSqliteSnapshotSource } from "../../transfer/index.js";
import { sqliteSnapshotClient } from "../../testing/sqlite-snapshot-client.js";

it("uses the injected opener read-only, reads full 64-bit cells/bytes/nulls, and owns only its snapshot handle", () => {
  const original = new Database(":memory:");
  try {
    original.exec("CREATE TABLE cells (id INTEGER PRIMARY KEY, payload BLOB, missing TEXT); INSERT INTO cells VALUES (9223372036854775807, x'00ff', NULL)");
    const bytes = original.serialize();
    const calls: { readonly: true }[] = [];
    let opened: Database.Database | undefined;
    const source = openSqliteSnapshotSource({ bytes }, { open: (data, options) => { calls.push(options); opened = new Database(data, options); return sqliteSnapshotClient({ db: opened }); } });
    try {
      expect(calls).toEqual([{ readonly: true }]);
      expect(source.tableNames()).toEqual(["cells"]);
      expect(source.columns("cells")).toEqual(["id", "payload", "missing"]);
      expect([...source.rows("cells", ["id", "payload", "missing"])]).toEqual([[9223372036854775807n, Buffer.from([0, 255]), null]]);
    } finally { source.close(); }
    expect(opened?.open).toBe(false);
    expect(original.open).toBe(true);
  } finally { original.close(); }
});
it("normalizes a WAL snapshot on a copied byte buffer without changing the caller's bytes", () => {
  const bytes = Buffer.alloc(32); bytes[18] = 2; bytes[19] = 2;
  let openedBytes: Buffer | undefined;
  const source = openSqliteSnapshotSource({ bytes }, { open: data => { openedBytes = data; return { prepare: () => { throw new Error("not used"); }, close: () => {} }; } });
  try {
    expect(openedBytes).not.toBe(bytes);
    expect([openedBytes![18], openedBytes![19]]).toEqual([1, 1]);
    expect([bytes[18], bytes[19]]).toEqual([2, 2]);
  } finally { source.close(); }
});
