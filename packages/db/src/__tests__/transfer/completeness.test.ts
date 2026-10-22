import { describe, expect, it } from "vitest";
import { IncompleteTransferPlanError, planTransfer, type TransferSource, type TransferTable } from "../../transfer/index.js";

const table = (name: string): TransferTable => ({ name, columns: [], primaryKey: [], indexes: [], foreignKeys: [], checks: [] });
const source = (names: string[]): TransferSource => ({ tableNames: () => names, layout: () => null, columns: () => [], countRows: () => 0, rows: () => [], close: () => {} });
describe("j03 per-source completeness", () => {
  it("keeps caller order and accounts independently for same-name tables in different sources", () => {
    const content = source(["child", "parent", "ledger"]);
    const chat = source(["parent"]);
    const sources = [{ name: "content", source: content, tables: [table("child"), table("parent")], leftOut: [{ table: "ledger", reason: "host-owned history" }] }, { name: "chat", source: chat, tables: [table("parent")], leftOut: [] }];
    expect(planTransfer({ sources }).sources).toEqual(sources);
    expect(sources[0]!.tables.map(t => t.name)).toEqual(["child", "parent"]);
  });
  it("reports every missing table by source; another source's catalog cannot hide it", () => {
    expect(() => planTransfer({ sources: [
      { name: "content", source: source(["rows"]), tables: [table("rows")], leftOut: [] },
      { name: "chat", source: source(["rows", "messages"]), tables: [], leftOut: [] },
    ] })).toThrowError(new IncompleteTransferPlanError({ missing: [{ source: "chat", table: "rows" }, { source: "chat", table: "messages" }] }));
  });
  it.each(["", "  ", "\n"])("a blank exclusion reason %j does not satisfy completeness", reason => {
    expect(() => planTransfer({ sources: [{ name: "chat", source: source(["sessions"]), tables: [], leftOut: [{ table: "sessions", reason }] }] })).toThrow(/sessions/);
  });
});
