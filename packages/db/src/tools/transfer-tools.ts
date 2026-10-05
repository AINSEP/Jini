import { readFile, unlink } from "node:fs/promises";
import { ToolInputError, type SurfaceEmission, type SurfaceEmitter, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { countSourceRows, inspectTarget, runCopy, planTransfer, SourceSchemaMismatchError, IncompleteTransferPlanError, InvalidConnectionStringError, LEFT_OUT_REASON, type PostgresTargetPort, type TransferSource, type TargetDescription, type TransferNaming, type SnapshotTablePlan, type TransferPlanSource } from "../transfer/index.js";
import { DOMAIN, PLAN_TOOL_ID, STATUS_TOOL_ID, RUN_PERMISSION, SNAPSHOT_SCOPE_ID, MIN_SERVER_VERSION_NUM, getDatabaseTransferAgentToolCatalog } from "./transfer-catalog.js";
import { defaultDbMessages, type DbMessages, type DbTransferMessages } from "../core/messages.js";
import type { DatabaseDestinationStorePort, SavedDatabaseDestination } from "./destination-port.js";
import type { DatabaseTransferPlan, DatabaseTransferPlanStore } from "./plan-store.js";
import type { TransferSurfacePorts, SurfaceExchange, SurfaceMessage } from "./surface-port.js";
import { registrations, type InputReaders } from "./registration.js";
const SET_DESTINATION_TOOL_ID = "database_transfer_set_destination";
const DATABASE_TRANSFER_RUN_TOOL_ID = "database_transfer_run";
/**
 * @file `database_transfer_plan` (read-only) and `database_transfer_run` (human-confirmed for replacement): COPY this
 * site's database into a host-named private area of any Postgres database, while the site keeps running
 * on its built-in storage. Plan slice P0 of `ADS-memory/reports/2026-09-27-assistant-db-transfer-plan.md`
 * — core tables, row-count check. Vendor-blind: a plugin (e.g. Supabase) supplies the destination
 * later; core never names one.
 *
 * The destination is never a tool input: `database_transfer_set_destination` raises a private form the
 * human pastes the address into (`destination-ui.ts`), and every other tool reads it from
 * `destination-store.ts`. `database_transfer_status` reports the destination, the last run and the copy
 * found there.
 *
 * Two calls, the `site_backup_plan`/`site_backup_push` shape: the plan snapshots the database
 * (`DbOpsPort.captureRestorePoint`, never the live file), connects to the destination, counts every
 * table and refuses anything that would fail (unreachable, too old, someone else's private area). The
 * replacement run raises the Copy/Cancel card and, on Copy, writes exactly the planned snapshot in one
 * transaction (`copy-engine.ts`); a first copy runs immediately without a card.
 *
 * The connection string is never returned, shown or logged: results carry only host, port, database
 * and user.
 */

/** All host policy, schema and UI effects enter through these ports; no consumer import is permitted. */
export interface DatabaseTransferToolPorts {
  workspaceId: string; site: string; naming: TransferNaming;
  clock: { nowIso(): string };
  dbOps: { getCapabilities(): Promise<{ restorePoint: { costClass: string; kind: string } }>; captureRestorePoint(input: { scopeId: string }): Promise<{ artifactRef: string }> };
  plans: Pick<DatabaseTransferPlanStore, "save" | "take">;
  destinations: DatabaseDestinationStorePort;
  target(connectionString: string): PostgresTargetPort;
  requirePermission(input: { principalId: string; permission: string; entityType: string }): Promise<void>;
  openSource(bytes: Buffer): TransferSource;
  catalog(name: string, source: TransferSource): SnapshotTablePlan;
  partialExclusions(name: string, source: TransferSource): { table: string; rows: number; reason: string }[];
  captureChatSnapshot(): Promise<Buffer>;
  failureLog(line: string): void;
  describeError(error: unknown): string;
  readonly schemaMismatchGuidance: string;
  readers: Pick<InputReaders, "inputRecord" | "string">;
  surfaces: TransferSurfacePorts;
}
/** Messages are bound once per factory; host ports remain live and prose never enters persisted naming. */
interface TransferExecutionPorts { readonly ports: DatabaseTransferToolPorts; readonly messages: DbMessages; }
interface Refusal {
  readonly code: string;
  readonly message: string;
}

function destinationsOf(deps: TransferExecutionPorts): DatabaseDestinationStorePort {
  return deps.ports.destinations;
}

function targetFor(deps: TransferExecutionPorts, connectionString: string): PostgresTargetPort {
  return deps.ports.target(connectionString);
}

function log(deps: TransferExecutionPorts, line: string): void {
  deps.ports.failureLog(`[database-transfer] ${line}`);
}

/**
 * A consistent copy of the site database, as bytes. The restore-point file is deleted as soon as it
 * is read.
 *
 * @complexity O(database size).
 */
async function captureSnapshot(deps: TransferExecutionPorts): Promise<{ ok: true; bytes: Buffer } | Refusal> {
  const { restorePoint } = await deps.ports.dbOps.getCapabilities();
  if (restorePoint.costClass !== "cheap" || restorePoint.kind !== "file-snapshot") {
    return { code: "UNAVAILABLE", message: "only a site on built-in storage (SQLite) can be copied" };
  }
  let artifactRef: string;
  try {
    ({ artifactRef } = await deps.ports.dbOps.captureRestorePoint({ scopeId: SNAPSHOT_SCOPE_ID }));
  } catch (err) {
    log(deps, `snapshot failed: ${deps.ports.describeError(err)}`);
    return { code: "DATABASE_SNAPSHOT_FAILED", message: "the site database could not be snapshotted; nothing was copied" };
  }
  try {
    return { ok: true, bytes: await readFile(artifactRef) };
  } catch (err) {
    log(deps, `snapshot read failed: ${deps.ports.describeError(err)}`);
    return { code: "DATABASE_SNAPSHOT_FAILED", message: "the site database snapshot could not be read; nothing was copied" };
  } finally {
    await unlink(artifactRef).catch(() => undefined);
  }
}

/** The site name copies are marked with; it also picks the site's schema (`copy-engine.ts`). */
function siteOf(deps: TransferExecutionPorts): string {
  return deps.ports.site;
}

/** Connection, version, permission, and which private schema this site's copy goes to. */
async function checkTarget(deps: TransferExecutionPorts, target: PostgresTargetPort, site: string): Promise<{ ok: true; schema: string; replaces: string | null } | Refusal> {
  const inspected = await inspectTarget({ target, site, naming: deps.ports.naming });
  const where = `${target.describe().database} on ${target.describe().host}`;
  if (!inspected.ok) return { code: "UNREACHABLE", message: `could not connect to ${where}: ${inspected.error}` };
  if (inspected.serverVersionNum < MIN_SERVER_VERSION_NUM) return { code: "SERVER_TOO_OLD", message: `${where} runs Postgres ${inspected.serverVersionNum}; version 14 or later is needed` };
  if (inspected.schema === null) {
    return { code: "TARGET_NOT_OURS", message: deps.messages.privateAreasTaken({ where }) };
  }
  if (inspected.schemaState === "absent" && !inspected.canCreateSchema) return { code: "NO_CREATE_PERMISSION", message: `the user '${target.describe().user}' may not create a private area in ${where}` };
  return { ok: true, schema: inspected.schema, replaces: inspected.lastCopy?.snapshotAt ?? null };
}

/** Open every planned snapshot and check source completeness before counting or writing. */
function snapshotSources(deps: TransferExecutionPorts, snapshot: Buffer, chatSnapshot?: Buffer): TransferPlanSource[] {
  const opened: TransferPlanSource[] = [];
  try {
    for (const [name, bytes] of [["content", snapshot], ...(chatSnapshot === undefined ? [] : [["chat", chatSnapshot]])] as [string, Buffer][]) {
      const source = deps.ports.openSource(bytes);
      try { opened.push({ name, source, ...deps.ports.catalog(name, source) }); }
      catch (error) { source.close(); throw error; }
    }
    return [...planTransfer({ sources: opened }).sources];
  } catch (error) { for (const entry of opened) entry.source.close(); throw error; }
}
/** Row counts and reasons use each physical source's own catalog; no raw-SQL tables disappear. */
function countSnapshot(deps: TransferExecutionPorts, bytes: Buffer, chatSnapshot?: Buffer): { ok: true; tableCount: number; rowCount: number; leftOut: DatabaseTransferPlan["leftOut"] } | Refusal {
  let sources: TransferPlanSource[] = [];
  try {
    sources = snapshotSources(deps, bytes, chatSnapshot);
    const counts = sources.flatMap(entry => countSourceRows({ source: entry.source, tables: entry.tables }, { messages: deps.messages }));
    // The human hears about their own data left behind; bookkeeping and derived search indexes
    // are not theirs to miss. This is the original disclosure rule, applied to every source.
    const leftOut = sources.flatMap(entry => [
      ...entry.leftOut.filter(item => item.reason !== LEFT_OUT_REASON.bookkeeping && item.reason !== LEFT_OUT_REASON.derived).map(item => ({ ...item, rows: entry.source.countRows(item.table) })),
      ...deps.ports.partialExclusions(entry.name, entry.source),
    ]);
    return { ok: true, tableCount: counts.length, rowCount: counts.reduce((sum, count) => sum + count.rows, 0), leftOut };
  } catch (err) {
    if (err instanceof SourceSchemaMismatchError || err instanceof IncompleteTransferPlanError) return { code: "SCHEMA_MISMATCH", message: `${err.message}; ${deps.ports.schemaMismatchGuidance}` };
    throw err;
  } finally { for (const entry of sources) entry.source.close(); }
}

function planResult(plan: DatabaseTransferPlan): Record<string, unknown> {
  return {
    planned: true,
    planId: plan.planId,
    expiresAt: new Date(plan.expiresAtMs).toISOString(),
    destination: plan.destination,
    area: plan.schema,
    snapshotAt: plan.snapshotAt,
    tableCount: plan.tableCount,
    rowCount: plan.rowCount,
    replaces: plan.replaces,
    leftOut: plan.leftOut.filter((entry) => entry.rows > 0),
    notes: ["The site keeps running on its built-in storage; this is a copy.", "Photos and files stay where they are; only their records are copied."],
    nextStep: "Tell the human what will be copied, then call database_transfer_run with this planId. It shows a Copy/Cancel card.",
  };
}

/**
 * The plan: parse, check permission, reach the destination, then snapshot and count. A refusal before
 * the snapshot costs no snapshot.
 *
 * @complexity One connection check plus O(database size) for the snapshot and O(tables) counts.
 */
async function handlePlan(deps: TransferExecutionPorts, ctx: ToolExecutionContext): Promise<Record<string, unknown>> {
  await deps.ports.requirePermission({ principalId: ctx.principal.id, permission: RUN_PERMISSION, entityType: DOMAIN });
  const destination = await destinationsOf(deps).get(deps.ports.workspaceId);
  if (destination === null) {
    return {
      planned: false,
      code: "NO_DESTINATION",
      message: deps.messages.noDestination,
      nextStep: `Call ${SET_DESTINATION_TOOL_ID}. It shows the human a private form for the database address; you never see it.`,
    };
  }
  const { connectionString } = destination;
  const target = targetFor(deps, connectionString);

  const checked = await checkTarget(deps, target, siteOf(deps));
  if (!("ok" in checked)) return { planned: false, ...checked };
  const snapshot = await captureSnapshot(deps);
  if (!("ok" in snapshot)) return { planned: false, ...snapshot };
  let chatSnapshot: Buffer;
  try { chatSnapshot = await deps.ports.captureChatSnapshot(); }
  catch (error) {
    log(deps, `chat snapshot failed: ${deps.ports.describeError(error)}`);
    return { planned: false, code: "DATABASE_SNAPSHOT_FAILED", message: "the chat database could not be snapshotted; nothing was copied" };
  }
  const counted = countSnapshot(deps, snapshot.bytes, chatSnapshot);
  if (!("ok" in counted)) return { planned: false, ...counted };

  const plan = deps.ports.plans.save({
    principalId: ctx.principal.id,
    workspaceId: deps.ports.workspaceId,
    content: {
      connectionString,
      destination: target.describe(),
      replaces: checked.replaces,
      snapshot: snapshot.bytes,
      chatSnapshot,
      snapshotAt: deps.ports.clock.nowIso(),
      site: siteOf(deps),
      schema: checked.schema,
      tableCount: counted.tableCount,
      rowCount: counted.rowCount,
      leftOut: counted.leftOut,
    },
  });
  return planResult(plan);
}

type RunResult = Record<string, unknown>;

async function askToConfirm(ctx: ToolExecutionContext, surfaces: TransferSurfacePorts, plan: DatabaseTransferPlan, emitSurface: SurfaceEmitter): Promise<{ confirmed: true } | { confirmed: false; result: RunResult }> {
  const exchange: SurfaceExchange = surfaces.open({ toolId: DATABASE_TRANSFER_RUN_TOOL_ID, principalId: ctx.principal.id }, emitSurface);
  const emission = surfaces.confirmation(plan, exchange.id, exchange.expiresAtMs ? { expiresAtMs: exchange.expiresAtMs() } : {});
  const closeOnAbort = () => exchange.close();
  ctx.signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    const outcome = await surfaces.resolveDecision(exchange, emission);
    if (outcome.confirmed) return { confirmed: true };
    if (outcome.reason === "declined") return { confirmed: false, result: { copied: false, cancelled: true } };
    return { confirmed: false, result: { copied: false, cancelled: false, reason: outcome.reason } };
  } finally {
    ctx.signal.removeEventListener("abort", closeOnAbort);
  }
}

/** @complexity O(total rows), streamed. */
async function copyPlanned(deps: TransferExecutionPorts, plan: DatabaseTransferPlan): Promise<RunResult> {
  const sources = snapshotSources(deps, plan.snapshot, plan.chatSnapshot);
  try {
    const result = await runCopy({ sources, naming: deps.ports.naming, target: targetFor(deps, plan.connectionString), schema: plan.schema, marker: { site: plan.site, snapshotAt: plan.snapshotAt }, replaceExisting: plan.replaces !== null }, { messages: deps.messages });
    if (!result.ok) {
      if (result.logDetail !== undefined) log(deps, `${DATABASE_TRANSFER_RUN_TOOL_ID}: ${result.code} ${result.logDetail}`);
      await destinationsOf(deps).recordRun(deps.ports.workspaceId, { copied: false, snapshotAt: plan.snapshotAt, code: result.code, message: result.message });
      return { copied: false, cancelled: false, code: result.code, message: result.message };
    }
    if (result.warning !== undefined) log(deps, `${DATABASE_TRANSFER_RUN_TOOL_ID}: ${result.warning}`);
    const rowCount = result.tables.reduce((sum, table) => sum + table.rows, 0);
    await destinationsOf(deps).recordRun(deps.ports.workspaceId, { copied: true, snapshotAt: plan.snapshotAt, tableCount: result.tables.length, rowCount });
    return {
      copied: true,
      destination: plan.destination,
      area: plan.schema,
      snapshotAt: plan.snapshotAt,
      tableCount: result.tables.length,
      rowCount,
      tables: result.tables,
      ...(result.unvalidatedConstraints.length === 0
        ? {}
        : {
            unvalidatedConstraints: result.unvalidatedConstraints,
            note: deps.messages.uncheckedLinks,
          }),
    };
  } finally {
    for (const entry of sources) entry.source.close();
  }
}

const PLAN_TAKE_MESSAGES = {
  PLAN_NOT_FOUND: "no copy plan with that planId is waiting (a planId works once, for this principal, and a server restart drops plans). Call database_transfer_plan again.",
  PLAN_EXPIRED: "that copy plan expired (plans last 10 minutes). Call database_transfer_plan again.",
} as const;

async function handleRun(deps: TransferExecutionPorts, surfaces: TransferSurfacePorts, ctx: ToolExecutionContext, optional: ToolExecutionOptions = {}): Promise<RunResult> {
  const planId = deps.ports.readers.string(deps.ports.readers.inputRecord(ctx.input), "planId");
  await deps.ports.requirePermission({ principalId: ctx.principal.id, permission: RUN_PERMISSION, entityType: DOMAIN });
  if (ctx.signal.aborted) return { copied: false, cancelled: false, reason: "abandoned" };
  const taken = deps.ports.plans.take({ planId, principalId: ctx.principal.id, workspaceId: deps.ports.workspaceId });
  if (!taken.ok) return { copied: false, cancelled: false, code: taken.code, message: PLAN_TAKE_MESSAGES[taken.code] };

  if (taken.plan.replaces !== null) {
    if (!optional.emitSurface) {
      throw new ToolInputError({ message: `${DATABASE_TRANSFER_RUN_TOOL_ID}: this execution context has no interactive confirmation channel (no emitSurface), so replacement cannot be confirmed here. Nothing was copied.` });
    }
    const decision = await askToConfirm(ctx, surfaces, taken.plan, optional.emitSurface);
    if (!decision.confirmed) return decision.result;
  }
  return copyPlanned(deps, taken.plan);
}

type SetDestinationResult =
  | { saved: true; destination: TargetDescription; replaces: string | null }
  | { saved: false; code: string; message: string }
  | { saved: false; reason: "cancelled" | "expired" | "abandoned" };

function failedDestination(surfaces: TransferSurfacePorts, exchangeId: string, code: string, message: string): { result: SetDestinationResult; outcome: SurfaceEmission } {
  return { result: { saved: false, code, message }, outcome: surfaces.destinationOutcome({ exchangeId, state: "failure", message: `Not saved: ${message}.` }) };
}

/**
 * The submitted address lives in one local for the width of this function: parsed, checked against
 * the real server, then saved. It is never returned, logged or put in the outcome card.
 *
 * @complexity One connection check.
 */
async function handleDestinationAnswer(deps: TransferExecutionPorts, surfaces: TransferSurfacePorts, exchangeId: string, answer: SurfaceMessage): Promise<{ result: SetDestinationResult; outcome?: SurfaceEmission }> {
  if (answer.status !== "received") return { result: { saved: false, reason: answer.status } };
  if (answer.params[surfaces.dismissedParam] === true) return { result: { saved: false, reason: "cancelled" } };
  const address = typeof answer.params[surfaces.addressField] === "string" ? (answer.params[surfaces.addressField] as string).trim() : "";
  let target: PostgresTargetPort;
  try {
    target = targetFor(deps, address);
  } catch (err) {
    if (err instanceof InvalidConnectionStringError) return failedDestination(surfaces, exchangeId, "INVALID_CONNECTION_STRING", err.message);
    throw err;
  }
  const checked = await checkTarget(deps, target, siteOf(deps));
  if (!("ok" in checked)) return failedDestination(surfaces, exchangeId, checked.code, checked.message);
  const destination: SavedDatabaseDestination = { connectionString: address, description: target.describe(), savedAt: deps.ports.clock.nowIso() };
  await destinationsOf(deps).save(deps.ports.workspaceId, destination);
  const { database, host } = destination.description;
  return {
    result: { saved: true, destination: destination.description, replaces: checked.replaces },
    outcome: surfaces.destinationOutcome({ exchangeId, state: "success", message: deps.messages.destinationSaved({ database, host }) }),
  };
}

async function handleSetDestination(deps: TransferExecutionPorts, surfaces: TransferSurfacePorts, ctx: ToolExecutionContext, optional: ToolExecutionOptions = {}): Promise<SetDestinationResult> {
  await deps.ports.requirePermission({ principalId: ctx.principal.id, permission: RUN_PERMISSION, entityType: DOMAIN });
  if (!optional.emitSurface) {
    throw new ToolInputError({ message: `${SET_DESTINATION_TOOL_ID}: this execution context has no interactive form channel (no emitSurface), so the human cannot type the address here. Nothing was saved.` });
  }
  if (ctx.signal.aborted) return { saved: false, reason: "abandoned" };
  const exchange = surfaces.open({ toolId: SET_DESTINATION_TOOL_ID, principalId: ctx.principal.id }, optional.emitSurface);
  const closeOnAbort = () => exchange.close();
  ctx.signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    return await surfaces.askThenReport(exchange, surfaces.destinationForm(exchange.id), (answer) => handleDestinationAnswer(deps, surfaces, exchange.id, answer));
  } finally {
    ctx.signal.removeEventListener("abort", closeOnAbort);
  }
}

/**
 * The saved destination (described, never the address), this process's last run, and the copy the
 * destination itself holds (its marker), when it can be reached.
 *
 * @complexity One connection check when a destination is saved.
 */
async function handleStatus(deps: TransferExecutionPorts, ctx: ToolExecutionContext): Promise<Record<string, unknown>> {
  await deps.ports.requirePermission({ principalId: ctx.principal.id, permission: RUN_PERMISSION, entityType: DOMAIN });
  const destination = await destinationsOf(deps).get(deps.ports.workspaceId);
  const lastRun = await destinationsOf(deps).lastRun(deps.ports.workspaceId);
  if (destination === null) return { destination: null, lastRun, copyOnDestination: null };
  const inspected = await inspectTarget({ target: targetFor(deps, destination.connectionString), site: siteOf(deps), naming: deps.ports.naming });
  const copyOnDestination = inspected.ok ? inspected.lastCopy : { unreachable: inspected.error };
  return { destination: destination.description, lastRun, copyOnDestination };
}

/**
 * Returns core registrations; the host applies its independent risk/error plumbing.
 * Descriptions reflect required persisted naming; optional messages replace model-facing copy only.
 * Construction performs no I/O. Host formatter exceptions propagate without mutating ports.
 * @complexity O(1) fixed tool records plus the description formatter's text length.
 * @example createDatabaseTransferTools(ports, { messages: defaultDbMessages })
 */
export function createDatabaseTransferTools(deps: DatabaseTransferToolPorts, optional: { messages?: DbTransferMessages & Partial<DbMessages> } = {}): ToolRegistration[] {
  const runtime: TransferExecutionPorts = { ports: deps, messages: { ...defaultDbMessages, ...optional.messages } };
  const handlers: Record<string, ToolHandler> = {
    [PLAN_TOOL_ID]: ctx => handlePlan(runtime, ctx),
    [DATABASE_TRANSFER_RUN_TOOL_ID]: (ctx, optional) => handleRun(runtime, runtime.ports.surfaces, ctx, optional),
    [SET_DESTINATION_TOOL_ID]: (ctx, optional) => handleSetDestination(runtime, runtime.ports.surfaces, ctx, optional),
    [STATUS_TOOL_ID]: ctx => handleStatus(runtime, ctx),
  };
  // Read checks and snapshot planning do not mutate durable state; run and saved destination do.
  const risks = new Map([[PLAN_TOOL_ID, "none"], [STATUS_TOOL_ID, "none"], [DATABASE_TRANSFER_RUN_TOOL_ID, "mutates-durable-state"], [SET_DESTINATION_TOOL_ID, "mutates-durable-state"]]);
  return registrations({ catalog: getDatabaseTransferAgentToolCatalog({}, { naming: deps.naming, messages: runtime.messages }), handlers, risks });
}
