/**
 * @module db-ops
 *
 * Daemon DB inspect/verify/vacuum operations, wired through the
 * tool-execution boundary (`@jini-ai/core`'s `tool-registry.ts` + `@jini-ai/daemon`'s
 * `tool-executor.ts`) rather than called directly from a route handler.
 * Ported from OD's `apps/daemon/src/routes/daemon.ts` `GET /api/daemon/db`,
 * `POST /api/daemon/db/verify`, `POST /api/daemon/db/vacuum` (see
 * `source-map.md`'s routes-classification table, row `#12 daemon.ts`: "generic
 * in shape but depend on a separate `storage/db-inspect.ts` port not built
 * this round" — that port now exists as `@jini-ai/sqlite`'s `db-inspect.ts`).
 *
 * This module does **not** depend on `@jini-ai/sqlite` or `better-sqlite3` at
 * all: `DaemonDbOperations` is a plain injected interface (structurally
 * compatible with `@jini-ai/sqlite`'s `inspectSqliteDatabase`/
 * `verifySqliteIntegrity` return shapes, so a caller can wire those in with
 * zero adapter code) — the same "caller supplies the real collaborator"
 * convention `daemon-status.ts`/`host-tools.ts` already established in this
 * package.
 *
 * **Why the tool-execution boundary, not a plain route handler calling
 * `DaemonDbOperations` directly:** these three operations reveal internal
 * schema/row-count/file-size information (`inspect`/`verify`) and rewrite the
 * database file in place (`vacuum`) — real security stakes the task brief
 * that added this module named explicitly. OD's own origin gated only
 * `verify`/`vacuum` behind `requireLocalDaemonRequest` and left `GET
 * /api/daemon/db` completely ungated — a real pre-existing gap, not carried
 * forward here. Per this repo's binding tool-execution-boundary precedent
 * (`packages/deploy/src/tool.ts`'s `deploy.publish`, `packages/daemon/src/
 * delegated-tool-bridge.ts`), the actual work happens only inside a
 * `ToolHandler` `ToolExecutor.execute` invokes after `ToolPolicy.authorize`
 * allows it — never directly from `registerDaemonDbRoutes`' handlers. All
 * three routes also keep `requireSameOrigin: true` as a first line of
 * defense (matching `daemon-status.ts`'s shutdown route), but that transport
 * gate is defense in depth, not a substitute for the tool-execution
 * boundary — see {@link denyAllDaemonDbPolicy}'s doc for why the default
 * policy denies every call rather than allowing one.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Principal, RunRef, ToolPolicy, ToolRegistration } from '@jini-ai/core';
import type { ToolExecutionResult, ToolExecutor } from '@jini-ai/daemon';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

/** The `ToolRegistry` id `GET /api/daemon/db` executes through. */
export const DB_INSPECT_TOOL_ID = 'daemon.db.inspect';
/** The `ToolRegistry` id `POST /api/daemon/db/verify` executes through. */
export const DB_VERIFY_TOOL_ID = 'daemon.db.verify';
/** The `ToolRegistry` id `POST /api/daemon/db/vacuum` executes through. */
export const DB_VACUUM_TOOL_ID = 'daemon.db.vacuum';

export interface DaemonDbTableInfo {
  readonly name: string;
  readonly rowCount: number;
}

/** Structurally identical to `@jini-ai/sqlite`'s `DaemonDbStatusReport` — defined locally so this package incurs no `better-sqlite3` dependency. */
export interface DaemonDbStatusReport {
  readonly kind: 'sqlite' | 'postgres';
  readonly location: string;
  readonly sizeBytes: number;
  readonly schemaVersion: number | null;
  readonly tables: readonly DaemonDbTableInfo[];
  readonly generatedAt: number;
}

export type DbIntegrityIssueKind = 'integrity' | 'foreign_key';

export interface DbIntegrityIssue {
  readonly kind: DbIntegrityIssueKind;
  readonly message: string;
}

/** Structurally identical to `@jini-ai/sqlite`'s `DbIntegrityReport`. */
export interface DbIntegrityReport {
  readonly ok: boolean;
  readonly mode: 'integrity_check' | 'quick_check';
  readonly issues: readonly DbIntegrityIssue[];
  readonly elapsedMs: number;
  readonly generatedAt: number;
}

export interface DaemonDbVacuumResult {
  readonly ok: true;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly reclaimedBytes: number;
  readonly elapsedMs: number;
}

/** The real collaborator a host injects — typically backed by `@jini-ai/sqlite`'s `inspectSqliteDatabase`/`verifySqliteIntegrity` plus a small `vacuum` wrapper around `db.exec('VACUUM')`. */
export interface DaemonDbOperations {
  inspect(): Promise<DaemonDbStatusReport> | DaemonDbStatusReport;
  verify(quick: boolean): Promise<DbIntegrityReport> | DbIntegrityReport;
  vacuum(): Promise<DaemonDbVacuumResult> | DaemonDbVacuumResult;
}

/**
 * Deny-by-default `ToolPolicy` shared by all three DB tools — every call is
 * denied, unconditionally, regardless of principal. Matching
 * `@jini-ai/deploy`'s `denyAllDeployPublishPolicy` precedent: a host must
 * explicitly opt in with its own policy (e.g. role-gated, or "same principal
 * that owns the daemon process") rather than getting a working DB inspector
 * for free merely by registering the tools. `inspect`/`verify` disclose
 * internal schema and row-count information; `vacuum` rewrites the database
 * file in place — none of the three has a safe "mostly harmless" default the
 * way a pure read-only, non-sensitive tool might.
 */
export const denyAllDaemonDbPolicy: ToolPolicy = {
  authorize: () => 'deny',
};

export interface CreateDaemonDbToolRegistrationsOptions {
  readonly operations: DaemonDbOperations;
  /** Defaults to {@link denyAllDaemonDbPolicy} — see its doc for why a permissive default was rejected. Applies to all three tools; pass distinct `ToolRegistration.policy` values by registering them individually if a host wants per-operation rules. */
  readonly policy?: ToolPolicy;
  readonly requiresConfirmation?: boolean;
  readonly timeoutMs?: number;
}

export interface DaemonDbToolRegistrations {
  readonly inspect: ToolRegistration;
  readonly verify: ToolRegistration;
  readonly vacuum: ToolRegistration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the three `{descriptor, handler, policy}` triples a host registers
 * against `@jini-ai/core`'s `ToolRegistry` so the DB operations become
 * reachable only via `ToolExecutor.execute(principal, run, toolId, input)` —
 * never by a route calling `operations.inspect()`/`verify()`/`vacuum()`
 * directly, which would bypass authorization and the audit trail entirely.
 *
 * @complexity O(1) to build the three registrations; each handler's own cost is `operations`'s.
 * @overallScore 100/100
 */
export function createDaemonDbToolRegistrations(
  options: CreateDaemonDbToolRegistrationsOptions,
): DaemonDbToolRegistrations {
  const { operations, policy = denyAllDaemonDbPolicy, requiresConfirmation, timeoutMs } = options;
  const descriptorExtras = {
    ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };

  return {
    inspect: {
      descriptor: {
        id: DB_INSPECT_TOOL_ID,
        description: 'Inspects the daemon SQLite database: schema version, table list, row counts, on-disk size.',
        ...descriptorExtras,
      },
      policy,
      handler: async () => operations.inspect(),
    },
    verify: {
      descriptor: {
        id: DB_VERIFY_TOOL_ID,
        description: 'Runs a SQLite integrity/foreign-key check against the daemon database.',
        ...descriptorExtras,
      },
      policy,
      handler: async (ctx) => {
        const input = isRecord(ctx.input) ? ctx.input : {};
        return operations.verify(input.quick === true);
      },
    },
    vacuum: {
      descriptor: {
        id: DB_VACUUM_TOOL_ID,
        description: 'Runs SQLite VACUUM against the daemon database and reports reclaimed bytes.',
        ...descriptorExtras,
      },
      policy,
      handler: async () => operations.vacuum(),
    },
  };
}

/** Diagnostic detail for an internal-error response the public API deliberately does not disclose (SEC-005, matching `runs.ts`'s `RunInternalErrorContext`): a `failed`/`timed-out`/`cancelled` tool execution can embed schema names, file paths, or a raw SQLite error message. */
export interface DaemonDbInternalErrorContext {
  readonly source: 'db-inspect' | 'db-verify' | 'db-vacuum';
  readonly correlationId: string;
  readonly error: unknown;
}

function defaultDaemonDbInternalErrorSink(context: DaemonDbInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http] internal error (${context.source}, correlationId=${context.correlationId})`, context.error);
}

export interface DaemonDbHttpDeps {
  readonly toolExecutor: ToolExecutor;
  /**
   * The identity these routes execute tool calls as. A fixed, host-supplied
   * value rather than derived per-request — this transport has no session/
   * identity subsystem of its own (see `packages/http/source-map.md`'s
   * `ExecutionDelegate` design-decision note); a host that needs per-request
   * principals should resolve one from its own auth layer and construct
   * `DaemonDbHttpDeps` per request, or supply a `ToolPolicy` that inspects
   * something other than `Principal` to make its decision.
   */
  readonly principal: Principal;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: DaemonDbInternalErrorContext) => void;
}

/** Every DB-ops call gets its own opaque, single-use `RunRef` — these are one-off operations requests, not steps of a longer-lived agent run, so there is no real run to attach the audit trail to. */
function freshRun(): RunRef {
  return { id: randomUUID() };
}

function toolResultToApiResult<T>(
  deps: DaemonDbHttpDeps,
  source: DaemonDbInternalErrorContext['source'],
  result: ToolExecutionResult,
): Result<T> {
  switch (result.status) {
    case 'completed':
      return ok(result.output as T);
    case 'denied':
      return err(createApiError('TOOL_OPERATION_DENIED', 'this operation was denied by policy'));
    case 'confirmation-denied':
      return err(createApiError('TOOL_OPERATION_DENIED', 'this operation was denied during confirmation'));
    case 'timed-out':
    case 'cancelled':
    case 'failed': {
      const correlationId = randomUUID();
      const sink = deps.onInternalError ?? defaultDaemonDbInternalErrorSink;
      sink({ source, correlationId, error: result.status === 'failed' ? result.error : result.status });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  }
}

/** `GET /api/daemon/db` — the database inventory (schema version, tables, row counts, size). */
export const daemonDbInspectRoute = defineJsonRoute<void, DaemonDbStatusReport, DaemonDbHttpDeps>({
  method: 'get',
  path: '/api/daemon/db',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const result = await deps.toolExecutor.execute(deps.principal, freshRun(), DB_INSPECT_TOOL_ID, undefined);
    return toolResultToApiResult<DaemonDbStatusReport>(deps, 'db-inspect', result);
  },
});

function parseDbVerifyInput(input: RouteInputContext): Result<{ quick: boolean }> {
  const raw = input.query.quick;
  if (raw === undefined) return ok({ quick: false });
  if (typeof raw !== 'string') {
    return err(validationError('quick must be a single query-string value when provided'));
  }
  const normalized = raw.toLowerCase();
  return ok({ quick: normalized === '1' || normalized === 'true' });
}

/** `POST /api/daemon/db/verify?quick=` — `PRAGMA integrity_check`/`quick_check` plus `foreign_key_check`. */
export const daemonDbVerifyRoute = defineJsonRoute<{ quick: boolean }, DbIntegrityReport, DaemonDbHttpDeps>({
  method: 'post',
  path: '/api/daemon/db/verify',
  requireSameOrigin: true,
  parse: parseDbVerifyInput,
  handle: async (input, deps) => {
    const result = await deps.toolExecutor.execute(deps.principal, freshRun(), DB_VERIFY_TOOL_ID, input);
    return toolResultToApiResult<DbIntegrityReport>(deps, 'db-verify', result);
  },
});

/** `POST /api/daemon/db/vacuum` — runs `VACUUM` and reports bytes reclaimed. */
export const daemonDbVacuumRoute = defineJsonRoute<void, DaemonDbVacuumResult, DaemonDbHttpDeps>({
  method: 'post',
  path: '/api/daemon/db/vacuum',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const result = await deps.toolExecutor.execute(deps.principal, freshRun(), DB_VACUUM_TOOL_ID, undefined);
    return toolResultToApiResult<DaemonDbVacuumResult>(deps, 'db-vacuum', result);
  },
});

/** Mounts all three DB-ops routes on `app`. A pack's `http(app, services)` calls this directly. */
export function registerDaemonDbRoutes(app: Express, deps: DaemonDbHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, daemonDbInspectRoute, deps, adapter);
  mountJsonRoute(app, daemonDbVerifyRoute, deps, adapter);
  mountJsonRoute(app, daemonDbVacuumRoute, deps, adapter);
}
