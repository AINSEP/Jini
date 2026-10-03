/** Factories are driven through their public registrations, with host effects behind ports. */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import { createDatabaseTransferTools, defaultDbMessages, DatabaseTransferPlanStore, type DatabaseTransferToolPorts, type TransferSurfacePorts } from "../../tools/index.js";
import { type TransferSource, type TransferTable, SourceSchemaMismatchError } from "../../transfer/index.js";

const description = { host: "fixture", database: "fixture", port: "5432", user: "owner" };
const ctx = (input: unknown = {}, signal = new AbortController().signal): ToolExecutionContext => ({ input, signal, principal: { id: "owner" }, run: { id: "run" }, executionId: "exec" });
function harness() {
  const calls: string[] = [];
  const sources: TransferSource[] = [];
  let now = 0;
  let allowed = true;
  let destination: Awaited<ReturnType<DatabaseTransferToolPorts["destinations"]["get"]>> = null;
  const plans = new DatabaseTransferPlanStore({}, { now: () => now });
  const surfaces: TransferSurfacePorts = {
    open: () => { calls.push("open"); return { id: "exchange", send: async () => {}, receive: async () => ({ status: "abandoned" }), close: () => { calls.push("close"); } }; },
    resolveDecision: async exchange => { exchange.close(); return { confirmed: false, reason: "declined" }; },
    askThenReport: async () => { throw new Error("unused"); },
    confirmation: () => ({ channel: "fixture", payload: {} }), destinationForm: () => ({ channel: "fixture", payload: {} }), destinationOutcome: () => ({ channel: "fixture", payload: {} }),
    dismissedParam: "dismissed", addressField: "address",
  };
  const ports: DatabaseTransferToolPorts = {
    site: "site", workspaceId: "ws", clock: { nowIso: () => "fixed" },
    naming: { defaultSchema: "app", markerTable: "_app_copy", unvalidatedTable: "pg_temp._app_unvalidated", schemaPrefix: "app_" },
    requirePermission: async () => { calls.push("authorize"); if (!allowed) throw new Error("denied"); },
    destinations: { get: async () => { calls.push("destination"); return destination; }, save: async (_workspace, value) => { destination = value; }, lastRun: async () => null, recordRun: async () => { calls.push("record-run"); } },
    plans, surfaces,
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } }), captureRestorePoint: async () => { calls.push("capture"); throw new Error("missing fixture"); } },
    captureChatSnapshot: async () => { calls.push("chat"); return Buffer.from("chat"); },
    target: () => { calls.push("target"); return { describe: () => description, query: async sql => ({ ok: true, value: sql.includes("current_setting") ? [["140000", "t"]] : sql.includes("SELECT unvalidated") ? [["[]"]] : [] }), runScript: async chunks => { calls.push([...chunks].join("")); return { ok: true, value: null }; } }; },
    openSource: bytes => {
      const name = bytes.toString();
      const source: TransferSource = { tableNames: () => [name], columns: () => ["id"], layout: () => null, countRows: () => 1, rows: () => [[name]], close: () => { calls.push(`closed:${name}`); } };
      sources.push(source); return source;
    },
    catalog: (_name, source) => ({ tables: source.tableNames().map(name => ({ name, columns: [{ name: "id", sqlType: "text", notNull: true }], primaryKey: ["id"], indexes: [], foreignKeys: [], checks: [] } satisfies TransferTable)), leftOut: [] }),
    partialExclusions: () => [], failureLog: () => {}, describeError: error => error instanceof Error ? error.constructor.name : typeof error,
    schemaMismatchGuidance: "fixture layout mismatch",
    readers: { inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]) },
  };
  const tools = new Map(createDatabaseTransferTools(ports).map(tool => [tool.descriptor.id, tool]));
  return { ports, tools, calls, sources, plans, deny: () => { allowed = false; }, expire: () => { now = 600001; }, saveDestination: () => { destination = { connectionString: "postgresql://owner:SECRET@fixture/db", description, savedAt: "fixed" }; } };
}
it("all transfer tools authorize before touching destination, captures, surfaces or plan consumption", async () => {
  const h = harness(); h.deny();
  for (const tool of h.tools.values()) {
    expect(tool.descriptor.readOnly).toBe(["database_transfer_plan", "database_transfer_status"].includes(tool.descriptor.id));
    await expect(tool.handler(ctx({ planId: "plan" }))).rejects.toThrow("denied");
  }
  expect(h.calls).toEqual(["authorize", "authorize", "authorize", "authorize"]);
});

// REGRESSION: fails if either NO_DESTINATION or TARGET_NOT_OURS keeps hardcoded consumer prose.
it("uses host refusal prose without snapshotting an unavailable destination", async () => {
  const h = harness();
  const messages = { ...defaultDbMessages, noDestination: "host has no destination", privateAreasTaken: ({ where }: { where: string }) => `host areas taken: ${where}` };
  const tools = new Map(createDatabaseTransferTools(h.ports, { messages }).map(tool => [tool.descriptor.id, tool]));
  expect(await tools.get("database_transfer_plan")!.handler(ctx())).toMatchObject({ code: "NO_DESTINATION", message: "host has no destination" });
  h.saveDestination();
  // Include the hash candidate computed by the public naming contract, so all areas are occupied.
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update("site").digest("hex").slice(0, 8);
  h.ports.target = () => ({ describe: () => description,
    query: async sql => ({ ok: true, value: sql.includes("current_setting") ? [["140000", "t"]] : sql.includes("pg_namespace") ? [["app"], ["app_site"], [`app_site_${hash}`]] : [] }),
    runScript: async () => { throw new Error("refusal must never write"); },
  });
  expect(await tools.get("database_transfer_plan")!.handler(ctx())).toMatchObject({ code: "TARGET_NOT_OURS", message: "host areas taken: fixture on fixture" });
  expect(h.calls).not.toContain("capture");
});

// REGRESSION: fails if unchecked-constraint output ignores optional.messages.uncheckedLinks.
it("renders host unchecked-link guidance after a successful copy", async () => {
  const h = harness();
  h.ports.target = () => ({ describe: () => description, query: async () => ({ ok: true, value: [['["content.link"]']] }), runScript: async () => ({ ok: true, value: null }) });
  const messages = { ...defaultDbMessages, uncheckedLinks: "host retained unchecked links" };
  const tools = new Map(createDatabaseTransferTools(h.ports, { messages }).map(tool => [tool.descriptor.id, tool]));
  const plan = h.plans.save({ principalId: "owner", workspaceId: "ws", content: { connectionString: "private", destination: description, snapshot: Buffer.from("content"), chatSnapshot: Buffer.from("chat"), replaces: null, site: "site", schema: "app", snapshotAt: "fixed", rowCount: 2, tableCount: 2, leftOut: [] } });
  expect(await tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }))).toMatchObject({ copied: true, unvalidatedConstraints: ["content.link"], note: "host retained unchecked links" });
  expect(h.calls).toContain("record-run");
});

// REGRESSION: fails if destination success surfaces keep a hardcoded message.
it("formats saved destination prose without exposing the private address", async () => {
  const h = harness();
  const outcomes: string[] = [];
  h.ports.surfaces.askThenReport = async (_exchange, _emission, handle) => {
    const answer = await handle({ status: "received", params: { address: "postgresql://owner:SECRET@fixture/db" } });
    return answer.result;
  };
  h.ports.surfaces.destinationOutcome = ({ message }) => { outcomes.push(message); return { channel: "fixture", payload: {} }; };
  const messages = { ...defaultDbMessages, destinationSaved: ({ database, host }: { database: string; host: string }) => `host destination: ${database} at ${host}` };
  const tools = new Map(createDatabaseTransferTools(h.ports, { messages }).map(tool => [tool.descriptor.id, tool]));
  const result = await tools.get("database_transfer_set_destination")!.handler(ctx(), { emitSurface: async () => {} });
  expect(result).toMatchObject({ saved: true, destination: description });
  expect(outcomes).toEqual(["host destination: fixture at fixture"]);
  expect(JSON.stringify([result, outcomes])).not.toContain("SECRET");
});
it("refuses no destination and expired/foreign plans without opening or copying", async () => {
  const h = harness();
  expect(await h.tools.get("database_transfer_plan")!.handler(ctx())).toMatchObject({ planned: false, code: "NO_DESTINATION" });
  const plan = h.plans.save({ principalId: "owner", workspaceId: "ws", content: { connectionString: "private", destination: description, snapshot: Buffer.from("content"), chatSnapshot: Buffer.from("chat"), replaces: null, site: "site", schema: "app", snapshotAt: "fixed", rowCount: 2, tableCount: 2, leftOut: [] } });
  const foreign = { ...ctx({ planId: plan.planId }), principal: { id: "other" } };
  expect(await h.tools.get("database_transfer_run")!.handler(foreign)).toMatchObject({ copied: false, code: "PLAN_NOT_FOUND" });
  h.expire();
  expect(await h.tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }))).toMatchObject({ copied: false, code: "PLAN_EXPIRED" });
  expect(h.calls).not.toContain("target"); expect(h.calls).not.toContain("open");
});
it("replacement fails closed without a surface channel and a first-copy plan is consumed only once", async () => {
  const h = harness();
  const plan = h.plans.save({ principalId: "owner", workspaceId: "ws", content: { connectionString: "private", destination: description, snapshot: Buffer.from("content"), replaces: "previous", site: "site", schema: "app", snapshotAt: "fixed", rowCount: 1, tableCount: 1, leftOut: [] } });
  await expect(h.tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }))).rejects.toBeInstanceOf(ToolInputError);
  expect(await h.tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }))).toMatchObject({ code: "PLAN_NOT_FOUND" });
  expect(h.calls).toEqual(["authorize", "authorize"]);
});

// REGRESSION: fails if the run handler drops its second-argument emitSurface option.
it("opens replacement confirmation through handler options and respects a declined copy", async () => {
  const h = harness();
  const plan = h.plans.save({ principalId: "owner", workspaceId: "ws", content: { connectionString: "private", destination: description, snapshot: Buffer.from("content"), replaces: "previous", site: "site", schema: "app", snapshotAt: "fixed", rowCount: 1, tableCount: 1, leftOut: [] } });
  expect(await h.tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }), { emitSurface: async () => {} })).toEqual({ copied: false, cancelled: true });
  expect(h.calls).toEqual(["authorize", "open", "close"]);
});
it("both snapshot sources close on a completeness/schema refusal, the temporary content artifact is consumed", async () => {
  const h = harness(); h.saveDestination();
  const dir = await mkdtemp(join(tmpdir(), "transfer-tools-"));
  const artifactRef = join(dir, "snapshot");
  try {
    await writeFile(artifactRef, "content");
    h.ports.dbOps.captureRestorePoint = async () => ({ artifactRef });
    h.ports.catalog = name => { if (name === "chat") throw new SourceSchemaMismatchError("missing chat column"); return { tables: [], leftOut: [{ table: "content", reason: "fixture exclusion" }] }; };
    const result = await h.tools.get("database_transfer_plan")!.handler(ctx());
    expect(result).toEqual({ planned: false, code: "SCHEMA_MISMATCH", message: "missing chat column; fixture layout mismatch" });
    expect(h.calls.filter(call => call.startsWith("closed:"))).toEqual(["closed:chat", "closed:content"]);
    await expect(readFile(artifactRef)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("a successful plan/run uses two source snapshots, emits no first-copy card, returns only destination description and records the run", async () => {
  const h = harness(); h.saveDestination();
  const dir = await mkdtemp(join(tmpdir(), "transfer-tools-"));
  try {
    const artifactRef = join(dir, "snapshot"); await writeFile(artifactRef, "content");
    h.ports.dbOps.captureRestorePoint = async () => ({ artifactRef });
    const plan = await h.tools.get("database_transfer_plan")!.handler(ctx()) as { planned: boolean; planId: string; tableCount: number; rowCount: number };
    expect([plan.planned, plan.tableCount, plan.rowCount]).toEqual([true, 2, 2]);
    const copied = await h.tools.get("database_transfer_run")!.handler(ctx({ planId: plan.planId }));
    expect(copied).toMatchObject({ copied: true, destination: description, tableCount: 2, rowCount: 2, tables: [{ name: "content", rows: 1 }, { name: "chat", rows: 1 }] });
    expect(JSON.stringify([plan, copied])).not.toContain("SECRET");
    expect(h.calls).not.toContain("open"); expect(h.calls).toContain("record-run");
    expect(h.calls.filter(call => call.startsWith("closed:"))).toEqual(["closed:content", "closed:chat", "closed:content", "closed:chat"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// REGRESSION: fails if createDatabaseTransferTools registers the static default catalog.
it("publishes descriptions for the host's actual naming and forwards message overrides", () => {
  const h = harness();
  const baseline = createDatabaseTransferTools(h.ports);
  const treatment = createDatabaseTransferTools({ ...h.ports, naming: { ...h.ports.naming, defaultSchema: "tenant_data", schemaPrefix: "tenant_" } });
  const plan = (tools: ReturnType<typeof createDatabaseTransferTools>) => tools.find(tool => tool.descriptor.id === "database_transfer_plan")!.descriptor;
  expect(plan(baseline).description).toContain("'app'");
  expect(plan(treatment).description).toContain("'tenant_data'");
  expect(plan(treatment).description).not.toEqual(plan(baseline).description);
  const localized = createDatabaseTransferTools(h.ports, { messages: {
    plan: ({ naming }) => `Localized preview for ${naming.defaultSchema}`,
    setDestination: "Private form", status: "Copy status", run: "Copy preview", planIdDescription: "Preview identifier",
  } });
  expect(plan(localized).description).toBe("Localized preview for app");
  expect(localized.map(tool => [tool.descriptor.id, tool.descriptor.readOnly])).toEqual(baseline.map(tool => [tool.descriptor.id, tool.descriptor.readOnly]));
  expect(h.calls).toEqual([]);
});
