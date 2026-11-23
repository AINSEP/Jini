import { defineJsonRoute, ok, type JsonRouteSpec, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file SPEC-019 C-301/C-302/C-303 — `POST /api/admin/v1/recovery/restore/{plan,confirm,execute}`
 * (ADR-045 §3's restore ceremony). Gated by `backup.read` (`plan`/`confirm`) / `backup.restore`
 * (`execute`, enforced inside the gated-mutation gateway's own fixed check-sequence). Mirrors the
 * taxonomy merge-term route's 3-endpoint shape. The host binds each step to
 * `@jini-ai/db/recovery/recovery-orchestrator`'s `planRestore`/`confirmRestore`/`executeRestore`
 * wrappers over its `Result`-wrapped gateway binding and the real operation-lock primitive those
 * wrappers were built to receive from a composition root (see the restore hooks' doc comment for the
 * disclosed scope boundary: the ceremony's token/authorize/lock plumbing is fully real, the final
 * physical `content.db` file replacement is not). These specs own the HTTP rules: the body checks,
 * the AUD-001 pre-authorization, and the status per ceremony error code.
 */

/** `backup.restore` — the permission `execute` pre-checks (and the gateway re-checks). */
const RESTORE_PERMISSION = "backup.restore";

/** A ceremony error as the orchestrator reports it; `message` is optional by contract. */
export interface RecoveryCeremonyError { code: string; message?: string }

/** The orchestrator's `Result` shape: a step either answers its value or a coded error. */
export type RecoveryCeremonyResult<T> = { ok: true; value: T } | { ok: false; error: RecoveryCeremonyError };

/** Host diagnosis thrown when the session layer did not run (a wiring bug → redacted 500). */
interface MissingPrincipalCopy {
  /** The host's own missing-session message, so its incident log names the miswiring. */
  missingPrincipalMessage: string;
}

/** `plan`'s one collaborator: the orchestrator's plan step, bound by the host to its gateway. */
export interface RecoveryRestorePlanRouteDeps extends MissingPrincipalCopy {
  planRestore: (required: { principalId: string; restorePointId: string }) => Promise<RecoveryCeremonyResult<unknown>>;
}

/** `confirm`'s one collaborator: the orchestrator's confirm step (mints the confirmation token). */
export interface RecoveryRestoreConfirmRouteDeps extends MissingPrincipalCopy {
  confirmRestore: (required: { principalId: string; planId: string; planHash: string; disclosureAcknowledged: boolean }) => Promise<RecoveryCeremonyResult<unknown>>;
}

/** `execute`'s collaborators: the gateway's instance-scoped pre-check and the orchestrator's execute step. */
export interface RecoveryRestoreExecuteRouteDeps extends MissingPrincipalCopy {
  authorizeRestoreExecution: (required: { principalId: string; permission: string }) => Promise<{ allowed: boolean; reason: string }>;
  executeRestore: (required: { principalId: string; confirmationToken: string; restorePointId: string }) => Promise<RecoveryCeremonyResult<unknown>>;
}

/** The principal fields these routes read: the id, as the ceremony's actor. */
export interface RecoveryRestorePrincipal { id: string }

/** The raw JSON body; validated in `handle`, after the principal (and `execute`'s pre-check), as the hand-written routes did. */
export type RecoveryRestoreInput = RouteInputContext["body"];

/** HTTP status per gateway error code — a lookup table rather than a switch so a new code (a
 *  sixth 409, say) is one more row, not one more branch. */
const STATUS_BY_RECOVERY_ERROR_CODE: Readonly<Record<string, number>> = {
  NOT_AUTHORIZED: 403,
  AGENT_CANNOT_CONFIRM: 403,
  ACTOR_CLASS_MISMATCH: 403,
  VALIDATION_ERROR: 400,
  RESTORE_POINT_NOT_FOUND: 404,
  COST_CLASS_UNAVAILABLE: 409,
  PLAN_STALE: 409,
  TOKEN_EXPIRED: 409,
  TOKEN_ALREADY_REDEEMED: 409,
  RESTORE_OPERATION_IN_FLIGHT: 409,
};

/**
 * Answers a step's value, or refuses with its mapped status and `{ error, code }` body. An unmapped
 * code (only `INTERNAL_ERROR` reaches here today) is rethrown so the host answers the same redacted
 * incident envelope as any thrown failure — the cause never reaches the body.
 * @complexity O(1).
 */
function settle<T>({ result }: { result: RecoveryCeremonyResult<T> }, _optional: Record<string, never> = {}): { ok: true; value: T } {
  if (result.ok) return ok({ value: result.value });
  const { code, message } = result.error;
  const status = STATUS_BY_RECOVERY_ERROR_CODE[code];
  if (status === undefined) throw new Error(message ?? code);
  rejectRoute({ status, error: message ?? code, code });
}

/** The session principal, or the host's own missing-session failure. @complexity O(1). */
function principalOf({ context, deps }: { context: RecoveryRestorePrincipal | undefined; deps: MissingPrincipalCopy }, _optional: Record<string, never> = {}): RecoveryRestorePrincipal {
  if (!context) throw new Error(deps.missingPrincipalMessage);
  return context;
}

/** A body field object; a missing or non-object body reads as `{}` (every field then fails its check). */
const fieldsOf = (input: RecoveryRestoreInput): Record<string, unknown> => (input ?? {}) as Record<string, unknown>;

const totalParse = (raw: RouteInputContext) => ok({ value: raw.body });

type RestoreSpec<D> = Omit<JsonRouteSpec<RecoveryRestoreInput, unknown, D, RecoveryRestorePrincipal>, "ports">;

/** `POST …/restore/plan` — no RBAC pre-check here: the gateway's plan step authorizes `backup.read`. */
export const recoveryRestorePlanRoute: RestoreSpec<RecoveryRestorePlanRouteDeps> = defineJsonRoute<RecoveryRestoreInput, unknown, RecoveryRestorePlanRouteDeps, RecoveryRestorePrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/restore/plan",
  parse: totalParse,
  handle: async ({ input, deps, context }) => {
    const principal = principalOf({ context, deps });
    const { restorePointId } = fieldsOf(input);
    if (typeof restorePointId !== "string") rejectRoute({ status: 400, error: "'restorePointId' (string) is required", code: "VALIDATION_ERROR" });
    return settle({ result: await deps.planRestore({ principalId: principal.id, restorePointId }) });
  },
});

/** `POST …/restore/confirm` — `disclosureAcknowledged` counts only when literally `true` (INV-02). */
export const recoveryRestoreConfirmRoute: RestoreSpec<RecoveryRestoreConfirmRouteDeps> = defineJsonRoute<RecoveryRestoreInput, unknown, RecoveryRestoreConfirmRouteDeps, RecoveryRestorePrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/restore/confirm",
  parse: totalParse,
  handle: async ({ input, deps, context }) => {
    const principal = principalOf({ context, deps });
    const { planId, planHash, disclosureAcknowledged } = fieldsOf(input);
    if (typeof planId !== "string" || typeof planHash !== "string") {
      rejectRoute({ status: 400, error: "'planId' and 'planHash' (strings) are required", code: "VALIDATION_ERROR" });
    }
    return settle({ result: await deps.confirmRestore({ principalId: principal.id, planId, planHash, disclosureAcknowledged: disclosureAcknowledged === true }) });
  },
});

/**
 * Audit finding AUD-001 (2026-07-16, external audit TM-20260716-full-session-001): `executeRestore`
 * acquires the shared cross-domain operation lock strictly before the gateway's execute runs — that
 * ordering exists for mutation-failure/lock-leak safety, not authorization, so an
 * unauthorized-but-authenticated caller could still reach and briefly hold the lock before the
 * gateway's own authorize() rejected them, contending with a concurrent authorized restore.
 * Authorize first, before any lock acquisition (and before the body is read); the gateway's fresh
 * authorize() re-check at execute time (CIC U-001) remains the authoritative check.
 *
 * The host binds the pre-check through the gateway's `authorizeForHooks` with `scopeKind:
 * "instance"` — `backup.restore`'s real scope — so it agrees with what execute's own internal check
 * decides. A workspace-scoped check here would let a workspace-scoped-but-not-instance-authorized
 * caller pass, briefly hold the lock, and only then be rejected deeper inside execute — reopening the
 * very race AUD-001 closed, one layer up.
 * @complexity O(1) plus the injected pre-check.
 */
async function preAuthorizeExecution({ deps, principalId }: { deps: RecoveryRestoreExecuteRouteDeps; principalId: string }, _optional: Record<string, never> = {}): Promise<void> {
  const { allowed, reason } = await deps.authorizeRestoreExecution({ principalId, permission: RESTORE_PERMISSION });
  if (allowed) return;
  rejectRoute({
    status: 403,
    error: `principal '${principalId}' is not authorized for '${RESTORE_PERMISSION}' (${reason})`,
    code: "NOT_AUTHORIZED",
    details: { permission: RESTORE_PERMISSION, reason },
  });
}

/** `POST …/restore/execute` — pre-authorized (AUD-001), then the orchestrator takes the lock and executes. */
export const recoveryRestoreExecuteRoute: RestoreSpec<RecoveryRestoreExecuteRouteDeps> = defineJsonRoute<RecoveryRestoreInput, unknown, RecoveryRestoreExecuteRouteDeps, RecoveryRestorePrincipal>({
  method: "post",
  path: "/api/admin/v1/recovery/restore/execute",
  parse: totalParse,
  handle: async ({ input, deps, context }) => {
    const principal = principalOf({ context, deps });
    await preAuthorizeExecution({ deps, principalId: principal.id });
    const { confirmationToken, restorePointId } = fieldsOf(input);
    if (typeof confirmationToken !== "string" || typeof restorePointId !== "string") {
      rejectRoute({ status: 400, error: "'confirmationToken' and 'restorePointId' (strings) are required", code: "VALIDATION_ERROR" });
    }
    return settle({ result: await deps.executeRestore({ principalId: principal.id, confirmationToken, restorePointId }) });
  },
});
