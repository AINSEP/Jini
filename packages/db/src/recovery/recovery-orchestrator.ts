import type { Clock } from "@jini-ai/core/primitives";
/**
 * @file SPEC-019 C-301/C-302/C-303 — the Recovery restore ceremony (ADR-045 §3, CIC U-001/U-002/
 * U-003).
 *
 * Purpose:
 * `planRestore` / `confirmRestore` / `executeRestore` — three separate exports, never a combined
 * single-call restore endpoint (AC-12, REQ-06). Each is a thin orchestration wrapper around the
 * SPEC-016 `core/gated-mutations` gateway (injected here as `deps.gateway`, since that module's
 * real binding is a composition-root concern outside this domain's own certified test suite) plus
 * this domain's own binding constraints:
 *
 * - `planRestore` (CIC U-003): re-checks `costClass` FRESH at call time via `db-ops.getCapabilities()`
 *   — never a cached value — and refuses to reach the gateway at all once `costClass==='unavailable'`
 *   is freshly confirmed (U-003-ORD1, REQ-12).
 * - `confirmRestore` (CIC U-002): rejects (mints no token) unless `disclosureAcknowledged===true`
 *   STRICTLY (not merely truthy) — the composite of "the client claims acknowledgment" AND "the
 *   `planId` resolves to a plan the server's own `planRestore` actually minted," the latter half
 *   delegated entirely to the injected gateway's own plan-provenance verification.
 * - `executeRestore` (CIC U-001-ORD1): acquires the shared, cross-domain `core/operation-lock`
 *   BEFORE the gateway's own `execute()` runs — the same primitive `features/database`'s
 *   `executeMigrateForward` acquires, never an independent Recovery-local check (GOV-ADR-002) —
 *   and always releases it afterward, success or failure. Never itself clears `PENDING_MIGRATION`
 *   (REQ-18/EC-07 — restoring to an older snapshot does not resolve schema drift against the
 *   current runtime, ADR-045 §4). A successful `RESTORED` completion attaches a deep-link back to
 *   the Database Timeline (REQ-16/AC-26) — the incident thread's closing hop (ADR-041 §7).
 *
 * How it relates to the project:
 * `deps.gateway` stands in for a composition root's binding over the real
 * `core/gated-mutations.plan/confirm/execute` (SPEC-016) plus this domain's own hooks
 * (`domain="backup.restore"`); this file owns none of that gateway's own fixed check-sequence
 * (authorize -> token state -> actor-class -> plan-hash -> redeem), only this domain's binding
 * constraints layered around it.
 */

export type PrincipalKind = "user" | "agent" | "api_key";

export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };

export interface RecoveryErrorPayload {
  code: string;
  message?: string;
}

interface RestoreCapabilities {
  costClass: "cheap" | "expensive" | "unavailable";
  restorePointKind: string;
}

export interface PlanRestoreDbOpsPort {
  getCapabilities(): Promise<RestoreCapabilities>;
}

export interface PlanRestoreGatewayPort {
  plan(input: {
    principalId: string;
    principalKind: PrincipalKind;
    restorePointId: string;
    costClass: RestoreCapabilities["costClass"];
  }): Promise<Result<unknown, RecoveryErrorPayload>>;
}

export interface PlanRestoreRequired {
  deps: { dbOps: PlanRestoreDbOpsPort; gateway: PlanRestoreGatewayPort };
  input: { principalId: string; principalKind: PrincipalKind; restorePointId: string };
}

/**
 * C-301/CIC U-003 — `plan()` step. Never reaches the gateway when a fresh `costClass` recheck
 * reports `'unavailable'` (U-003-ORD1); `'expensive'` still reaches it (only `'unavailable'`
 * short-circuits, per ADR-041 §2's "no attestation override" carried into this domain).
 *
 * @complexity O(1) plus one `getCapabilities()` call and, when not short-circuited, one
 * `gateway.plan()` call.
 */
export async function planRestore(
  required: PlanRestoreRequired,
  _optional: Record<string, never> = {}
): Promise<Result<unknown, RecoveryErrorPayload>> {
  const { deps, input } = required;

  const capabilities = await deps.dbOps.getCapabilities();
  if (capabilities.costClass === "unavailable") {
    return {
      ok: false,
      error: {
        code: "COST_CLASS_UNAVAILABLE",
        message: `restore point '${input.restorePointId}' has no available restore mechanism for this site (no attestation override)`,
      },
    };
  }

  return deps.gateway.plan({
    principalId: input.principalId,
    principalKind: input.principalKind,
    restorePointId: input.restorePointId,
    costClass: capabilities.costClass,
  });
}

export interface ConfirmRestoreGatewayPort {
  confirm(input: { planId: string; planHash: string }): Promise<Result<unknown, RecoveryErrorPayload>>;
}

export interface ConfirmRestoreRequired {
  deps: { gateway: ConfirmRestoreGatewayPort };
  input: {
    principalId: string;
    principalKind: PrincipalKind;
    planId: string;
    planHash: string;
    disclosureAcknowledged: boolean;
  };
}

/**
 * C-302/CIC U-002 — `confirm()` step. `disclosureAcknowledged` must be exactly `true` (a truthy
 * non-boolean, e.g. the string `"true"`, is rejected — U-002-B1's exact wording) before the
 * gateway is ever consulted; plan provenance (whether `planId` was actually minted by this
 * server's own `planRestore`) is verified entirely by the injected gateway, never re-derived or
 * short-circuit-trusted here (U-002-ORD1).
 *
 * @complexity O(1) plus, when the acknowledgment gate passes, one `gateway.confirm()` call.
 */
export async function confirmRestore(
  required: ConfirmRestoreRequired,
  _optional: Record<string, never> = {}
): Promise<Result<unknown, RecoveryErrorPayload>> {
  const { deps, input } = required;

  if (input.disclosureAcknowledged !== true) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "disclosureAcknowledged must be exactly true before a restore confirmation token may be minted",
      },
    };
  }

  return deps.gateway.confirm({ planId: input.planId, planHash: input.planHash });
}

export interface ExecuteRestoreGatewayPort {
  execute(input: { confirmationToken: string; confirmerPrincipalId?: string }): Promise<
    Result<{ restoreRunId: string; state: string; restartRequired?: boolean }, RecoveryErrorPayload>
  >;
}

interface OperationLockHandle {
  siteId: string;
  operationKind: string;
  acquiredAt: string;
}

export interface ExecuteRestoreOperationLockPort {
  acquireOperationLock(params: {
    deps: { clock: Clock };
    input: { siteId: string; operationKind: "migration" | "restore" };
  }): Promise<{ ok: true; value: OperationLockHandle } | { ok: false; error: { code: string; message?: string } }>;
  releaseOperationLock(params: {
    deps: { clock: Clock };
    input: { siteId: string; handle: OperationLockHandle };
  }): Promise<void>;
}

export interface ExecuteRestorePendingMigrationTrackerPort {
  clearPendingMigration(): Promise<void>;
}

export interface ExecuteRestoreRequired {
  deps: {
    gateway: ExecuteRestoreGatewayPort;
    operationLock: ExecuteRestoreOperationLockPort;
    clock: Clock;
    /** Never invoked by this function (REQ-18/EC-07) — accepted only so a caller cannot be
     * tempted to wire an implicit clear-on-success elsewhere; kept in the seam to make the
     * "never called" property directly testable. */
    pendingMigrationTracker?: ExecuteRestorePendingMigrationTrackerPort;
  };
  input: {
    principalId: string;
    principalKind: PrincipalKind;
    confirmationToken: string;
    siteId: string;
    /** Required only for `principalKind==='agent'` — the agent's current delegator, used as the
     * confirmer identity the gateway's own actor-class rule compares against (SPEC-016 REQ-13). */
    delegatedByPrincipalId?: string;
  };
}

export interface ExecuteRestoreValue {
  restoreRunId: string;
  state: string;
  /** Attached only on `state==='RESTORED'` (REQ-16/AC-26) — the deep-link back to the Database
   * Timeline that closes the incident thread ADR-041 §7 describes. */
  databaseTimelineDeepLink?: { v: 1; siteId: string; intent: "view" };
  /** 2026-07-16: `true` when the physical content.db file was actually swapped (real SQLite
   * composition) — the running process keeps serving the pre-restore data from its already-open
   * file handle until an operator restarts it. `false`/absent for the hermetic in-memory
   * composition, which has no real file to restore into. */
  restartRequired?: boolean;
}

/**
 * C-303/CIC U-001-ORD1 — `execute()` step. Acquires the shared cross-domain operation lock BEFORE
 * the gateway's own `execute()` runs, and releases it in a `finally` regardless of outcome (never
 * leaks a held lock). Never calls `pendingMigrationTracker.clearPendingMigration()` — a restore to
 * an older snapshot does not, by itself, resolve schema drift against the current runtime
 * (ADR-045 §4).
 *
 * @complexity O(1) plus one lock acquire/release pair and one `gateway.execute()` call.
 */
export async function executeRestore(
  required: ExecuteRestoreRequired,
  _optional: Record<string, never> = {}
): Promise<Result<ExecuteRestoreValue, RecoveryErrorPayload>> {
  const { deps, input } = required;

  const acquireResult = await deps.operationLock.acquireOperationLock({
    deps: { clock: deps.clock },
    input: { siteId: input.siteId, operationKind: "restore" },
  });
  if (!acquireResult.ok) {
    return {
      ok: false,
      error: {
        code: "RESTORE_OPERATION_IN_FLIGHT",
        message: acquireResult.error.message ?? `an operation is already in flight for site '${input.siteId}'`,
      },
    };
  }

  try {
    const confirmerPrincipalId = input.principalKind === "agent" ? input.delegatedByPrincipalId : input.principalId;
    const executeResult = await deps.gateway.execute({
      confirmationToken: input.confirmationToken,
      ...(confirmerPrincipalId !== undefined ? { confirmerPrincipalId } : {}),
    });
    if (!executeResult.ok) {
      return executeResult;
    }

    const value: ExecuteRestoreValue = { ...executeResult.value };
    if (value.state === "RESTORED") {
      value.databaseTimelineDeepLink = { v: 1, siteId: input.siteId, intent: "view" };
    }
    return { ok: true, value };
  } finally {
    await deps.operationLock.releaseOperationLock({
      deps: { clock: deps.clock },
      input: { siteId: input.siteId, handle: acquireResult.value },
    });
  }
}
