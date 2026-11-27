import { BackstopRefusal } from "../backstop-refusal.js";
import { PublishContentApplyRowError } from "../../transfer/index.js";
import { contentHash } from "../content-hash.js";
import { describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@jini-ai/core/contracts/events";
import { MissingMutationActorError } from "../../../core/mutation-actor.js";
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

// The apply port merges the run's trusted actor into the handler deps; `null` drives a handler outside a run.
function setup(config: RawRowContributorConfig, initial: Record<string, string>, selection: string[], mutationActor: MutationActor | null = { id: "u", kind: "user" }) {
  const rows = memoryRows(initial);
  const bound = createRawRowContributor<Record<string, never>>(config);
  const deps: PublishContentDeps<Record<string, never>> = {
    workspaceId: "ws", ports: {}, clock: { nowMs: () => 0 }, idGen: { newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    changeSets: new InMemoryChangeSetRepo(), outbox: { enqueue: async () => {} } as never, authorize: async () => ({ allowed: true, reason: "test" }),
    backstop: { rows: rows.port, inverses: [], coveredTables: ["covered"], coveredRoots: [],
      selection: { rows: selection.map((id) => ({ table: "widgets", pk: { id } })) } },
    ...(mutationActor ? { mutationActor } : {}),
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

  it("records the apply run's trusted actor on the change set (FIX 19 / H2)", async () => {
    const f = setup(allow, { a: "old" }, ["a"], { id: "u", kind: "agent" });
    const [packed] = await f.pack();
    const incoming = { ...packed!, state: { ...packed!.state, values: { id: "a", title: "new" } } };
    const entity = { ...incoming, contentHash: (await import("../content-hash.js")).contentHash({ entityType: "raw-row", state: incoming.state }) };
    await f.handler.apply({ entity, principalId: "u", idempotencyKey: "k", expectedVersion: (await f.handler.inspect({ id: entity.id }))!.version } as never);
    const [changeSet] = await (f.deps.changeSets as InMemoryChangeSetRepo).listByWorkspace({ workspaceId: "ws" });
    expect(changeSet?.actor).toEqual({ id: "u", kind: "agent" });
  });

  it("refuses a send with no trusted actor before the row is written (FIX 19 / H2)", async () => {
    const f = setup(allow, { a: "old" }, ["a"], null);
    const [packed] = await f.pack();
    const incoming = { ...packed!, state: { ...packed!.state, values: { id: "a", title: "new" } } };
    const entity = { ...incoming, contentHash: (await import("../content-hash.js")).contentHash({ entityType: "raw-row", state: incoming.state }) };
    const apply = f.handler.apply({ entity, principalId: "u", idempotencyKey: "k", expectedVersion: (await f.handler.inspect({ id: entity.id }))!.version } as never);
    await expect(apply).rejects.toBeInstanceOf(MissingMutationActorError);
    expect(f.rows.store.get("a")).toBe("old");
    expect(await (f.deps.changeSets as InMemoryChangeSetRepo).listByWorkspace({ workspaceId: "ws" })).toEqual([]);
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

it.each([
  { title: 1.25, expected: null, name: "finite real" },
  { title: Number.POSITIVE_INFINITY, expected: "The raw row must contain a valid value for every column.", name: "infinite value" },
  { title: Number.MAX_SAFE_INTEGER + 1, expected: "The raw row must contain a valid value for every column.", name: "unsafe integer" },
  { title: { blobBase64: "YQ==" }, expected: null, name: "valid base64 BLOB" },
  { title: { blobBase64: "YQ==" , extra: "bad" }, expected: "The raw row must contain a valid value for every column.", name: "BLOB with extra fields" },
  { title: { blobBase64: "%%%=" }, expected: "The raw row must contain a valid value for every column.", name: "invalid base64 BLOB" },
])("validates a $name against the live row contract", async ({ title, expected }) => {
  const f = setup(allow, { a: "old" }, ["a"]);
  const [packed] = await f.pack();
  const state = { ...packed!.state, values: { id: "a", title } };
  // Non-finite numbers cannot be hashed as JSON identities. This case must fail before the hash read.
  const incoming = { ...packed!, state, contentHash: Number.isFinite(title) || typeof title !== "number"
    ? contentHash({ entityType: "raw-row", state }) : packed!.contentHash };
  expect(await f.handler.precheck({ entity: incoming })).toBe(expected);
  expect(f.rows.store.get("a")).toBe("old");
});

it("preserves specific policy refusals from row reads but propagates other failures", async () => {
  const f = setup(allow, { a: "old" }, ["a"]);
  const [entity] = await f.pack();
  const refusal = new BackstopRefusal({ message: "The table is currently restricted." });
  const fault = new Error("storage driver disappeared");
  f.rows.port.columns = vi.fn<RawRowPort["columns"]>().mockRejectedValueOnce(refusal).mockRejectedValueOnce(fault);
  expect(await f.handler.precheck({ entity: entity! })).toBe("The table is currently restricted.");
  await expect(f.handler.precheck({ entity: entity! })).rejects.toBe(fault);
  f.rows.port.read = vi.fn<RawRowPort["read"]>().mockRejectedValueOnce(refusal).mockRejectedValueOnce(fault);
  expect(await f.pack()).toEqual([]);
  expect(await f.handler.listSkipped?.()).toEqual([{ entityType: "raw-row", id: entity!.id, label: entity!.id,
    reason: "The table is currently restricted." }]);
  await expect(f.pack()).rejects.toBe(fault);
});

it("refuses a row changed after checking and never overwrites the newer live value", async () => {
  const f = setup(allow, { a: "old" }, ["a"]);
  const [entity] = await f.pack();
  const checked = await f.handler.inspect({ id: entity!.id });
  f.rows.store.set("a", "newer live edit");
  await expect(f.handler.apply({ entity: entity!, expectedVersion: checked!.version, principalId: "u", idempotencyKey: "stale" }))
    .rejects.toThrow(new PublishContentApplyRowError({ rowOutcome: "conflict", message: "This row changed on live after it was checked." }));
  expect(f.rows.store.get("a")).toBe("newer live edit");
  expect(f.deps.backstop?.inverses).toEqual([]);
});

it("undoing a newly created row removes only that key", async () => {
  const source = setup(allow, { a: "incoming" }, ["a"]);
  const [entity] = await source.pack();
  const destination = setup(allow, { b: "keep me" }, []);
  expect(destination.rows.store.has("a")).toBe(false);
  await destination.handler.apply({ entity: entity!, expectedVersion: undefined, principalId: "u", idempotencyKey: "new-row" });
  expect(destination.rows.store.get("a")).toBe("incoming");
  expect(await destination.bound.undoRawRow({ deps: destination.deps, entity: entity!, before: null, afterHash: entity!.contentHash })).toBeNull();
  expect([...destination.rows.store]).toEqual([["b", "keep me"]]);
});
