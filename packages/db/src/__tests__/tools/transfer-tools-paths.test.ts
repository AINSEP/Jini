/**
 * Refusal, failure and lifecycle paths of the four transfer tools, driven through their public
 * registrations with every host effect (destination store, Postgres target, snapshot files, surfaces)
 * behind hand-written fakes.
 */
import { expect, it } from "vitest";
import { ToolInputError, type SurfaceMessage, type ToolExecutionContext, type ToolExecutionOptions } from "@jini-ai/core";
import { createDatabaseTransferTools, DatabaseTransferPlanStore, type DatabaseTransferPlanContent, type DatabaseTransferToolPorts, type SavedDatabaseDestination, type SnapshotFilePort, type TransferSurfacePorts } from "../../tools/index.js";
import { parseConnectionString, type PostgresTargetPort, type TargetResult, type TransferSource } from "../../transfer/index.js";

const description = { host: "fixture-host", database: "fixture-db", port: "5432", user: "owner" };
const savedDestination: SavedDatabaseDestination = { connectionString: "postgresql://owner@fixture-host/fixture-db", description, savedAt: "earlier" };
const withSurface: ToolExecutionOptions = { emitSurface: async () => {} };

/** What the fake Postgres answers to each query `inspectTarget` and `runCopy` make. */
interface TargetScript {
  state?: TargetResult<string[][]>;
  markers?: string[][];
  markerRow?: string[];
  taken?: string[][];
  script?: TargetResult<null>;
  unvalidated?: TargetResult<string[][]>;
}
function fakeTarget(script: TargetScript, log: string[]): PostgresTargetPort {
  return {
    describe: () => description,
    query: async sql => {
      if (sql.includes("current_setting")) return script.state ?? { ok: true, value: [["160000", "t"]] };
      if (sql.includes("FROM pg_class")) return { ok: true, value: script.markers ?? [] };
      if (sql.startsWith("SELECT site, snapshot_at")) return { ok: true, value: script.markerRow === undefined ? [] : [script.markerRow] };
      if (sql.includes("FROM pg_namespace")) return { ok: true, value: script.taken ?? [] };
      if (sql.startsWith("SELECT unvalidated")) return script.unvalidated ?? { ok: true, value: [["[]"]] };
      throw new Error(`unexpected query: ${sql}`);
    },
    runScript: async chunks => { log.push(`script:${[...chunks].length > 0}`); return script.script ?? { ok: true, value: null }; },
  };
}

function harness({ costClass = "cheap", kind = "file-snapshot" }: { costClass?: string; kind?: string } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const runs: unknown[] = [];
  const controller = new AbortController();
  let destination: SavedDatabaseDestination | null = null;
  let target: TargetScript = {};
  let permissionHook: (count: number) => void = () => {};
  let permissions = 0;
  const files: SnapshotFilePort & { content: Buffer | Error; unlinkError?: Error } = {
    content: Buffer.from("content"),
    readFile: async path => { calls.push(`read:${path}`); if (files.content instanceof Error) throw files.content; return files.content; },
    unlink: async path => { calls.push(`unlink:${path}`); if (files.unlinkError) throw files.unlinkError; },
  };
  const surfaces: TransferSurfacePorts = {
    open: () => { calls.push("open"); return { id: "exchange", send: async () => {}, receive: async () => ({ status: "abandoned" }), close: () => { calls.push("close"); } }; },
    confirmApproval: async () => ({ confirmed: false, reason: "declined" }),
    askThenReport: async () => { throw new Error("no answer scripted"); },
    destinationForm: () => ({ channel: "form", payload: {} }),
    destinationOutcome: ({ state, message }) => { calls.push(`outcome:${state}:${message}`); return { channel: "outcome", payload: { state } }; },
    dismissedParam: "dismissed", addressField: "address",
  };
  const ports: DatabaseTransferToolPorts = {
    site: "site", workspaceId: "ws", clock: { nowIso: () => "now" },
    naming: { defaultSchema: "app", markerTable: "_app_copy", unvalidatedTable: "pg_temp._app_unvalidated", schemaPrefix: "app_" },
    requirePermission: async () => { permissions++; permissionHook(permissions); },
    destinations: {
      get: async () => destination, save: async (_ws, value) => { destination = value; calls.push("saved"); },
      lastRun: async () => ({ copied: true, snapshotAt: "earlier", tableCount: 1, rowCount: 1 }), recordRun: async (_ws, summary) => { runs.push(summary); },
    },
    plans: new DatabaseTransferPlanStore({}, { now: () => 0 }), surfaces,
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass, kind } }), captureRestorePoint: async () => { calls.push("capture"); return { artifactRef: "/snapshots/one" }; } },
    captureChatSnapshot: async () => Buffer.from("chat"),
    target: connectionString => { calls.push("target"); parseConnectionString({ raw: connectionString }); return fakeTarget(target, calls); },
    openSource: bytes => {
      const name = bytes.toString();
      const source: TransferSource = { tableNames: () => [name], columns: () => ["id"], layout: () => null, countRows: () => 3, rows: () => [[name]], close: () => { calls.push(`closed:${name}`); } };
      return source;
    },
    catalog: (_name, source) => ({ tables: source.tableNames().map(name => ({ name, columns: [{ name: "id", sqlType: "text", notNull: true }], primaryKey: ["id"], indexes: [], foreignKeys: [], checks: [] })), leftOut: [] }),
    partialExclusions: () => [], failureLog: line => { logs.push(line); }, describeError: error => error instanceof Error ? error.message : String(error),
    schemaMismatchGuidance: "rebuild the destination",
    readers: { inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]) },
  };
  const tools = new Map(createDatabaseTransferTools(ports, { files }).map(tool => [tool.descriptor.id, tool]));
  const ctx = (input: unknown = {}): ToolExecutionContext => ({ input, signal: controller.signal, principal: { id: "owner" }, run: { id: "run" }, executionId: "exec" });
  const call = (id: string, input?: unknown, options?: ToolExecutionOptions) => tools.get(id)!.handler(ctx(input), options);
  const savePlan = (content: Partial<DatabaseTransferPlanContent> = {}, { chat = true } = {}) => ports.plans.save({ principalId: "owner", workspaceId: "ws", content: {
    connectionString: savedDestination.connectionString, destination: description, snapshot: Buffer.from("content"), ...(chat ? { chatSnapshot: Buffer.from("chat") } : {}),
    replaces: null, site: "site", schema: "app", snapshotAt: "planned", rowCount: 6, tableCount: 2, leftOut: [], ...content,
  } });
  return {
    ports, files, surfaces, calls, logs, runs, controller, call, savePlan,
    useDestination: () => { destination = savedDestination; },
    scriptTarget: (script: TargetScript) => { target = script; },
    onPermission: (hook: (count: number) => void) => { permissionHook = hook; },
  };
}

// --- database_transfer_plan ---------------------------------------------------------------------

it.each([
  { label: "a non-cheap restore point", costClass: "expensive", kind: "file-snapshot" },
  { label: "a cheap restore point that is not a file snapshot", costClass: "cheap", kind: "logical-dump" },
])("plan refuses $label as UNAVAILABLE without capturing", async ({ costClass, kind }) => {
  const h = harness({ costClass, kind }); h.useDestination();
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, code: "UNAVAILABLE", message: "only a site on built-in storage (SQLite) can be copied" });
  expect(h.calls).not.toContain("capture");
});

it("plan reports a failed capture as DATABASE_SNAPSHOT_FAILED and logs the described error", async () => {
  const h = harness(); h.useDestination();
  h.ports.dbOps.captureRestorePoint = async () => { throw new Error("disk full"); };
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, code: "DATABASE_SNAPSHOT_FAILED", message: "the site database could not be snapshotted; nothing was copied" });
  expect(h.logs).toEqual(["[database-transfer] snapshot failed: disk full"]);
  expect(h.calls.some(call => call.startsWith("unlink:"))).toBe(false);
});

it("plan reports an unreadable snapshot file and still deletes it", async () => {
  const h = harness(); h.useDestination();
  h.files.content = new Error("EACCES");
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, code: "DATABASE_SNAPSHOT_FAILED", message: "the site database snapshot could not be read; nothing was copied" });
  expect(h.logs).toEqual(["[database-transfer] snapshot read failed: EACCES"]);
  expect(h.calls).toContain("unlink:/snapshots/one");
});

it("plan succeeds even when the read snapshot file cannot be deleted", async () => {
  const h = harness(); h.useDestination();
  h.files.unlinkError = new Error("EBUSY");
  expect(await h.call("database_transfer_plan")).toMatchObject({ planned: true, tableCount: 2, rowCount: 6, replaces: null, area: "app" });
  expect(h.calls).toEqual(expect.arrayContaining(["read:/snapshots/one", "unlink:/snapshots/one"]));
});

it("plan names the earlier copy it replaces when the destination already holds this site's copy", async () => {
  const h = harness(); h.useDestination();
  h.scriptTarget({ markers: [["app_site"]], markerRow: ["site", "2026-01-01T00:00:00Z", "f"] });
  expect(await h.call("database_transfer_plan")).toMatchObject({ planned: true, area: "app_site", replaces: "2026-01-01T00:00:00Z" });
});

it.each([
  { label: "an unreachable server", script: { state: { ok: false, error: "timeout" } }, expected: { code: "UNREACHABLE", message: "could not connect to fixture-db on fixture-host: timeout" } },
  { label: "a server older than 14", script: { state: { ok: true, value: [["130000", "t"]] } }, expected: { code: "SERVER_TOO_OLD", message: "fixture-db on fixture-host runs Postgres 130000; version 14 or later is needed" } },
  { label: "a user who may not create the private area", script: { state: { ok: true, value: [["160000", "f"]] } }, expected: { code: "NO_CREATE_PERMISSION", message: "the user 'owner' may not create a private area in fixture-db on fixture-host" } },
] satisfies { label: string; script: TargetScript; expected: { code: string; message: string } }[])("plan refuses $label before any snapshot", async ({ script, expected }) => {
  const h = harness(); h.useDestination(); h.scriptTarget(script);
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, ...expected });
  expect(h.calls).not.toContain("capture");
});

it("plan reports a failed chat capture after the content snapshot", async () => {
  const h = harness(); h.useDestination();
  h.ports.captureChatSnapshot = async () => { throw new Error("chat locked"); };
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, code: "DATABASE_SNAPSHOT_FAILED", message: "the chat database could not be snapshotted; nothing was copied" });
  expect(h.logs).toEqual(["[database-transfer] chat snapshot failed: chat locked"]);
});

it("plan turns an incomplete catalog into SCHEMA_MISMATCH and closes both sources", async () => {
  const h = harness(); h.useDestination();
  h.ports.catalog = () => ({ tables: [], leftOut: [] });
  expect(await h.call("database_transfer_plan")).toEqual({ planned: false, code: "SCHEMA_MISMATCH", message: "incomplete transfer plan: content: content, chat: chat; rebuild the destination" });
  expect(h.calls.filter(call => call.startsWith("closed:"))).toEqual(["closed:content", "closed:chat"]);
});

it("plan rethrows an unexpected catalog failure after closing what it opened", async () => {
  const h = harness(); h.useDestination();
  h.ports.catalog = name => { if (name === "chat") throw new Error("catalog bug"); return { tables: [], leftOut: [{ table: "content", reason: "fixture" }] }; };
  await expect(h.call("database_transfer_plan")).rejects.toThrow("catalog bug");
  expect(h.calls.filter(call => call.startsWith("closed:"))).toEqual(["closed:chat", "closed:content"]);
});

// --- database_transfer_run ----------------------------------------------------------------------

it("run copies a content-only plan as one source", async () => {
  const h = harness();
  const plan = h.savePlan({ rowCount: 3, tableCount: 1 }, { chat: false });
  expect(await h.call("database_transfer_run", { planId: plan.planId })).toEqual({
    copied: true, destination: description, area: "app", snapshotAt: "planned", tableCount: 1, rowCount: 3, tables: [{ name: "content", rows: 3 }],
  });
  expect(h.calls.filter(call => call.startsWith("closed:"))).toEqual(["closed:content"]);
  expect(h.runs).toEqual([{ copied: true, snapshotAt: "planned", tableCount: 1, rowCount: 3 }]);
});

it("run records and logs a refused copy with its redacted detail", async () => {
  const h = harness();
  h.scriptTarget({ script: { ok: false, error: "TRANSFER_COUNT_MISMATCH content" } });
  const plan = h.savePlan();
  const message = "the copy of 'content' did not match, so the whole copy was thrown away. Any earlier copy is untouched.";
  expect(await h.call("database_transfer_run", { planId: plan.planId })).toEqual({ copied: false, cancelled: false, code: "COUNT_MISMATCH", message });
  expect(h.logs).toEqual(["[database-transfer] database_transfer_run: COUNT_MISMATCH TRANSFER_COUNT_MISMATCH content"]);
  expect(h.runs).toEqual([{ copied: false, snapshotAt: "planned", code: "COUNT_MISMATCH", message }]);
});

it("run records a refusal that carries no log detail without writing to the failure log", async () => {
  const h = harness();
  h.scriptTarget({ script: { ok: false, error: "TRANSFER_TARGET_NOT_OURS" } });
  const plan = h.savePlan();
  expect(await h.call("database_transfer_run", { planId: plan.planId })).toMatchObject({ copied: false, cancelled: false, code: "TARGET_NOT_OURS" });
  expect(h.logs).toEqual([]);
  expect(h.runs).toMatchObject([{ copied: false, code: "TARGET_NOT_OURS" }]);
});

it("run logs the read-back warning of a committed copy whose unchecked list is unreadable", async () => {
  const h = harness();
  h.scriptTarget({ unvalidated: { ok: false, error: "gone" } });
  const plan = h.savePlan();
  expect(await h.call("database_transfer_run", { planId: plan.planId })).toMatchObject({ copied: true, rowCount: 6 });
  expect(h.logs).toEqual(["[database-transfer] database_transfer_run: the copy finished, but its list of unchecked constraints could not be read back"]);
});

it("run returns the human's non-decline reason for a replacement that was not confirmed", async () => {
  const h = harness();
  h.surfaces.confirmApproval = async () => ({ confirmed: false, reason: "expired" });
  const plan = h.savePlan({ replaces: "earlier" });
  expect(await h.call("database_transfer_run", { planId: plan.planId }, withSurface)).toEqual({ copied: false, cancelled: false, reason: "expired" });
  expect(h.runs).toEqual([]);
});

it("run abandons without copying when the call is aborted while permission is re-checked", async () => {
  const h = harness();
  h.onPermission(count => { if (count === 2) h.controller.abort(); });
  const plan = h.savePlan();
  expect(await h.call("database_transfer_run", { planId: plan.planId })).toEqual({ copied: false, cancelled: false, reason: "abandoned" });
  expect(h.calls.some(call => call.startsWith("script:"))).toBe(false);
  expect(h.runs).toEqual([]);
});

// --- database_transfer_set_destination ----------------------------------------------------------

it("set_destination refuses a context without a form channel after authorizing, opening nothing", async () => {
  const h = harness();
  await expect(h.call("database_transfer_set_destination")).rejects.toThrow(ToolInputError);
  await expect(h.call("database_transfer_set_destination")).rejects.toThrow("no interactive form channel (no emitSurface)");
  expect(h.calls).not.toContain("open");
});

it("set_destination returns abandoned for an already-aborted call without opening a form", async () => {
  const h = harness(); h.controller.abort();
  expect(await h.call("database_transfer_set_destination", {}, withSurface)).toEqual({ saved: false, reason: "abandoned" });
  expect(h.calls).not.toContain("open");
});

function answering(h: ReturnType<typeof harness>, answer: SurfaceMessage, during: () => void = () => {}) {
  const outcomes: unknown[] = [];
  h.surfaces.askThenReport = async ({ handle }) => { during(); const handled = await handle(answer); outcomes.push(handled.outcome); return handled.result; };
  return outcomes;
}

it.each([
  { answer: { status: "expired" } as SurfaceMessage, expected: { saved: false, reason: "expired" } },
  { answer: { status: "abandoned" } as SurfaceMessage, expected: { saved: false, reason: "abandoned" } },
  { answer: { status: "received", params: { dismissed: true, address: "postgresql://owner@h/db" } } as SurfaceMessage, expected: { saved: false, reason: "cancelled" } },
])("set_destination saves nothing for answer $answer.status", async ({ answer, expected }) => {
  const h = harness();
  const outcomes = answering(h, answer);
  expect(await h.call("database_transfer_set_destination", {}, withSurface)).toEqual(expected);
  expect(outcomes).toEqual([undefined]);
  expect(h.calls).not.toContain("saved");
  expect(h.calls).not.toContain("target");
});

it.each([
  { label: "a non-string address", params: { address: 42 } },
  { label: "a malformed address", params: { address: "  not a url  " } },
])("set_destination reports $label as INVALID_CONNECTION_STRING with a failure card", async ({ params }) => {
  const h = harness();
  answering(h, { status: "received", params });
  const result = await h.call("database_transfer_set_destination", {}, withSurface) as { saved: boolean; code: string; message: string };
  expect(result).toEqual({ saved: false, code: "INVALID_CONNECTION_STRING", message: "the connection string is not a valid postgres:// URL" });
  expect(h.calls).toContain("outcome:failure:Not saved: the connection string is not a valid postgres:// URL.");
  expect(h.calls).not.toContain("saved");
});

it("set_destination rethrows a target factory failure that is not a parse error", async () => {
  const h = harness();
  h.ports.target = () => { throw new Error("adapter crashed"); };
  answering(h, { status: "received", params: { address: "postgresql://owner@h/db" } });
  await expect(h.call("database_transfer_set_destination", {}, withSurface)).rejects.toThrow("adapter crashed");
  expect(h.calls).not.toContain("saved");
});

it("set_destination reports an unreachable destination and does not save it", async () => {
  const h = harness();
  h.scriptTarget({ state: { ok: false, error: "refused" } });
  answering(h, { status: "received", params: { address: " postgresql://owner:pw@fixture-host/fixture-db " } });
  expect(await h.call("database_transfer_set_destination", {}, withSurface)).toEqual({ saved: false, code: "UNREACHABLE", message: "could not connect to fixture-db on fixture-host: refused" });
  expect(h.calls).toContain("outcome:failure:Not saved: could not connect to fixture-db on fixture-host: refused.");
  expect(h.calls).not.toContain("saved");
});

it("set_destination closes the exchange when the call is aborted mid-question, and only then", async () => {
  const h = harness();
  answering(h, { status: "abandoned" }, () => h.controller.abort());
  expect(await h.call("database_transfer_set_destination", {}, withSurface)).toEqual({ saved: false, reason: "abandoned" });
  expect(h.calls.filter(call => call === "close")).toEqual(["close"]);

  const quiet = harness();
  answering(quiet, { status: "expired" });
  await quiet.call("database_transfer_set_destination", {}, withSurface);
  quiet.controller.abort();
  // The abort listener was removed when the call settled, so a late abort closes nothing.
  expect(quiet.calls.filter(call => call === "close")).toEqual([]);
});

// --- database_transfer_status -------------------------------------------------------------------

it("status without a saved destination reports only the last run", async () => {
  const h = harness();
  expect(await h.call("database_transfer_status")).toEqual({ destination: null, lastRun: { copied: true, snapshotAt: "earlier", tableCount: 1, rowCount: 1 }, copyOnDestination: null });
  expect(h.calls).not.toContain("target");
});

it("status describes the destination and the copy it holds, never the address", async () => {
  const h = harness(); h.useDestination();
  h.scriptTarget({ markers: [["app_site"]], markerRow: ["site", "2026-01-01T00:00:00Z", "f"] });
  const status = await h.call("database_transfer_status");
  expect(status).toEqual({ destination: description, lastRun: { copied: true, snapshotAt: "earlier", tableCount: 1, rowCount: 1 }, copyOnDestination: { site: "site", snapshotAt: "2026-01-01T00:00:00Z" } });
  expect(JSON.stringify(status)).not.toContain("postgresql://");
});

it("status reports an unreachable destination's error in place of its copy", async () => {
  const h = harness(); h.useDestination();
  h.scriptTarget({ state: { ok: false, error: "timeout" } });
  expect(await h.call("database_transfer_status")).toMatchObject({ destination: description, copyOnDestination: { unreachable: "timeout" } });
});
