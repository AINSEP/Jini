import { describe, expect, it } from "vitest";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { createRawRowContributor, rawRowId } from "../raw-row-contributor.js";
import type { RawRowContributorConfig } from "../raw-row-contributor.js";
import type { RawColumn, RawRowPort, RawRowSnapshot, PackedEntity } from "../../transfer/index.js";
import type { PublishContentDeps } from "../type-registry.js";

const COLUMNS: RawColumn[] = [{ name: "id", type: "TEXT", pk: 1, notnull: 0 }, { name: "title", type: "TEXT", pk: 0, notnull: 0 }];
const allow: RawRowContributorConfig = {
  policy: { checkRawTable: () => null, checkRawValues: () => null },
  limits: { rows: 2 },
  copy: { tooManyRows: "HOST-COPY: too many rows" },
};

/** An in-memory row port over one table, so the engine's decisions are the only thing under test. */
function memoryRows(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const snap = (id: string): RawRowSnapshot => ({ table: "widgets", columns: COLUMNS, pk: { id }, values: { id, title: store.get(id)! } });
  const port: RawRowPort = {
    columns: async () => COLUMNS,
    read: async ({ pk }) => (store.has(String(pk.id)) ? snap(String(pk.id)) : null),
    upsert: async ({ values }) => { store.set(String(values.id), String(values.title)); },
    removeCreated: async ({ pk }) => { store.delete(String(pk.id)); },
    transaction: async ({ work }) => work(),
  };
  return { port, store, snap };
}

function setup(config: RawRowContributorConfig, initial: Record<string, string>, selection: string[]) {
  const rows = memoryRows(initial);
  const bound = createRawRowContributor<Record<string, never>>(config);
  const deps: PublishContentDeps<Record<string, never>> = {
    workspaceId: "ws", ports: {}, clock: { nowMs: () => 0 }, idGen: { newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    changeSets: new InMemoryChangeSetRepo(), outbox: { enqueue: async () => {} } as never, authorize: async () => ({ allowed: true, reason: "test" }),
    backstop: { rows: rows.port, inverses: [], coveredTables: ["covered"], coveredRoots: [],
      selection: { rows: selection.map((id) => ({ table: "widgets", pk: { id } })) } },
  };
  const handler = bound.contributeRawRowPublish().build(deps);
  const pack = async () => { const out: PackedEntity[] = []; for await (const e of handler.pack()) out.push(e); return out; };
  return { rows, bound, deps, handler, pack };
}

describe("createRawRowContributor", () => {
  it("packs a selected row and reports it as unchanged against live", async () => {
    const f = setup(allow, { a: "one" }, ["a"]);
    const [entity] = await f.pack();
    expect(entity?.id).toBe(rawRowId({ table: "widgets", pk: { id: "a" } }));
    expect((await f.handler.inspect({ id: entity!.id }))?.hash).toBe(entity!.contentHash);
    expect(await f.handler.precheck({ entity: entity! })).toBeNull();
  });

  it("refuses with the message the injected table policy returns, and skips the row", async () => {
    const config = { ...allow, policy: { ...allow.policy, checkRawTable: () => "host table refusal" } };
    const f = setup(config, { a: "one" }, ["a"]);
    expect(await f.pack()).toEqual([]);
    expect((await f.handler.listSkipped!())[0]?.reason).toBe("host table refusal");
  });

  it("scans values through the injected value policy before accepting a row", async () => {
    const f = setup({ ...allow, policy: { ...allow.policy, checkRawValues: ({ values }) => (values.title === "leak" ? "host value refusal" : null) } }, { a: "leak" }, ["a"]);
    expect(await f.pack()).toEqual([]);
    expect((await f.handler.listSkipped!())[0]?.reason).toBe("host value refusal");
  });

  it("throws the injected copy when the selection exceeds the injected row limit", async () => {
    const f = setup(allow, { a: "1", b: "2", c: "3" }, ["a", "b", "c"]);
    await expect(f.pack()).rejects.toThrow("HOST-COPY: too many rows");
    const within = setup({ ...allow, limits: { rows: 3 } }, { a: "1", b: "2", c: "3" }, ["a", "b", "c"]);
    expect(await within.pack()).toHaveLength(3);
  });

  it("applies a changed row, records the inverse, and undo restores it only while live still matches", async () => {
    const f = setup(allow, { a: "old" }, ["a"]);
    const [packed] = await f.pack();
    const incoming = { ...packed!, state: { ...packed!.state, values: { id: "a", title: "new" } } };
    const entity = { ...incoming, contentHash: (await import("../content-hash.js")).contentHash({ entityType: "raw-row", state: incoming.state }) };
    const live = await f.handler.inspect({ id: entity.id });
    await f.handler.apply({ entity, principalId: "u", idempotencyKey: "k", expectedVersion: live!.version } as never);
    expect(f.rows.store.get("a")).toBe("new");
    const inverse = f.deps.backstop!.inverses![0] as { before: RawRowSnapshot | null; afterHash: string };
    expect(await f.bound.undoRawRow({ deps: f.deps, entity, before: inverse.before, afterHash: inverse.afterHash })).toBeNull();
    expect(f.rows.store.get("a")).toBe("old");
    f.rows.store.set("a", "edited-after");
    expect(await f.bound.undoRawRow({ deps: f.deps, entity, before: inverse.before, afterHash: inverse.afterHash })).toContain("changed on live after this send");
  });

  it("refuses covered tables on the destination without consulting the host table policy", async () => {
    let asked = 0;
    const f = setup({ ...allow, policy: { ...allow.policy, checkRawTable: () => { asked++; return null; } } }, { a: "1" }, ["a"]);
    const [packed] = await f.pack();
    asked = 0;
    const reason = await f.handler.precheck({ entity: { ...packed!, state: { ...packed!.state, table: "Covered" } } });
    expect(reason).toBe("Table 'Covered' already publishes normally; use Overwrite live in normal publishing.");
    expect(asked).toBe(0);
  });
});
