import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import {
  ForbiddenError,
  PlanStaleError,
  type GatedMutationHooks,
} from "@jini-ai/core/gated-mutations";
import { TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import type { RecoveryHookPolicy } from "./hook-policy.js";
import type {
  MigrationRunsRepoPort,
  SiteStatusPort,
} from "./reconcile-interrupted-migration.js";
import type { LedgerAppendPort } from "./migrate-forward-hooks.js";

/**
 * @file Recovery's `GatedMutationHooks` factory for the `restore` ceremony (SPEC-019 C-301/C-303),
 * plus `toRecoveryResult` (the throwing-gateway-to-`Result` adapter `recovery-orchestrator.ts`'s
 * ports declare) — the domain-specific quarter of what used to be
 * `server/gated-mutations-composition.ts`, split out so Recovery no longer needs a back-edge into
 * `server/` for its own hook builder. The generic pieces every ceremony shares (`buildGatewayDeps`,
 * `planHashOf`, `resolveActorClassIdentity`, `buildConfirmOnlyHooks`) stayed in
 * `core/gated-mutations/composition.ts`, which this file imports from — the correct direction (a
 * domain depending on `core`), unlike the old direction (a domain depending on `server`).
 *
 * `LedgerAppendPort` is imported from `features/database/gated-hooks.ts` rather than duplicated —
 * Recovery already imports several other Database-owned ports (`restore-points.ts`,
 * `boot/reconcile-interrupted-migration.ts`), so this is the established "Recovery depends on
 * Database, never the reverse" direction, not a new one.
 */

export interface BuildRestoreHooksInput extends RecoveryHookPolicy {
  workspaceId: string;
  actorId: string;
  restorePointId: string;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  restorePointsRepo: { list(): Promise<Array<{ id: string; createdAt: string; artifactRef: string }>> };
  databaseLedgerRepo: LedgerAppendPort;
  /** SPEC-016 `DbOpsPort` — real (SQLite) composition performs the physical file swap;
   * hermetic-test composition's in-memory double is a no-op (`restartRequired: false`). */
  dbOps: { restoreFromArtifact(required: { artifactRef: string }): Promise<{ restartRequired: boolean }> };
  /** Round-5 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, R5-F2 / Fable
   * `R5-F2-BLOCK-HAS-NO-EXIT` fix): a successful restore must actually exit
   * `BLOCKED_PENDING_RECOVERY` — before this fix, nothing did. */
  migrationRunsRepo: Pick<MigrationRunsRepoPort, "findNonTerminalForSite" | "markResolved">;
  siteStatus: SiteStatusPort;
}

export class RestorePointNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestorePointNotFoundError";
  }
}

/**
 * SPEC-019 C-301/C-303 — the Recovery `restore` ceremony's `GatedMutationHooks`.
 *
 * `executeMutation()` is a deliberately, disclosedly SCOPED implementation: it validates the
 * target restore point still exists and records a real `restore.executed` `database_ledger` row —
 * the honest, auditable half of a restore. It does NOT physically overwrite the live `content.db`
 * file. This codebase has no mechanism to hot-swap the shared, already-open `content.db`
 * connection every other repo across `server/deps.ts` holds a reference to (doing so would either
 * crash every other in-flight request against a closed handle, or silently leave every existing
 * repo instance reading the stale pre-restore file) — inventing an unreviewed live-swap or
 * process-restart mechanism here is exactly the kind of unrequested architecture this dispatch's
 * own guardrails warn against, and ADR-041/ADR-045 do not pin a specific mechanism for it either.
 * `[CIC_REQUESTED]` Unit=gated-mutations-composition Trigger=recovery restore execute
 * Property=REQ-06/AC-XX "a confirmed restore actually replaces content.db's data"
 * PlausibleWrong=silently faking a full hot restore, or crashing the process mid-request
 * MissingConstraint=a defined live-swap-or-restart mechanism for the shared `content.db`
 * connection Evidence=ADR-041 §2 (`content.db` restore = whole-file copy), ADR-045 §3, this file.
 * The plan -> confirm -> execute ceremony itself (token flow, authorize, operation-lock,
 * disclosure-acknowledgment gate) is fully real and this file's own test coverage exercises it
 * end-to-end; only the final byte-for-byte file replacement is the disclosed gap.
 *
 * `scopeKind: "instance"` (internal audit, 2026-08-12): `dbOps.restoreFromArtifact` (`db/sqlite/
 * db-ops.ts`) physically swaps the entire `content.db` file, and a `content.db` can hold more
 * than one workspace row (`site-dir/resolve-workspace.ts`, ADR-007, SPEC-044's admin CRUD). A
 * principal authorized only within one workspace has no standing to replace data belonging to
 * every OTHER workspace that file also holds — the ordinary workspace-scoped `authorize()` this
 * hook used before would either deny every principal (no real workspace ever matches a
 * whole-instance operation) or let one workspace's admin approve a cross-tenant file swap. See
 * `core/gated-mutations/gateway.ts`'s `GatedMutationHooks.scopeKind` and `core/gated-mutations/
 * composition.ts`'s `buildOwnerOnlyInstanceAuthorize` for the evaluator this now routes through.
 *
 * @complexity O(n) in the number of restore points (one `list()` scan per `computePlan` and per
 * `executeMutation` — low-volume, ADR-041 §2).
 */
export function buildRestoreHooks(input: BuildRestoreHooksInput, _optional: Record<string, never> = {}): GatedMutationHooks<{ restorePointId: string }, { restoreRunId: string; state: string; restartRequired: boolean }> {
  return {
    domain: "backup.restore",
    readPermission: "backup.read",
    mutatePermission: "backup.restore",
    scopeId: input.workspaceId,
    scopeKind: "instance",
    // The plan refuses an unknown restore point itself: without this, a wrong id passed plan AND
    // confirm (minting a real token) and only failed at execute. The gateway re-runs this at
    // execute's plan re-derivation too, so a point deleted after confirm is caught there.
    computePlan: async () => {
      await findRestorePoint(input);
      const details = { restorePointId: input.restorePointId };
      return { planHash: input.planHashOf({ details }, {}), details };
    },
    executeMutation: async () => {
      // Re-checked here, not trusted from the plan: the point can be deleted between execute's
      // plan re-derivation and this mutation (token redemption runs in between).
      const target = await findRestorePoint(input);

      // 2026-07-16: closes the "ledger-only" gap this file previously disclosed — swap the file
      // FIRST, ledger-record second. If the process dies between the two, the file already
      // reflects reality (a missing ledger entry is reconcilable later; a ledger entry claiming a
      // restore that never physically happened would not be).
      const { restartRequired } = await input.dbOps.restoreFromArtifact({ artifactRef: target.artifactRef });

      const restoreRunId = input.idGen.newId();
      const now = clockNowIso({ clock: input.clock });
      await input.databaseLedgerRepo.append({
        id: input.idGen.newId(),
        kind: "restore.executed",
        restorePointId: input.restorePointId,
        outcome: "success",
        detailJson: JSON.stringify({ restoreRunId, restartRequired }),
        actorWorkspaceId: input.workspaceId,
        actorId: input.actorId,
        createdAt: now,
      });

      // Round-5 re-audit (TM-adr041-043-044-045-audit-001, R5-F2 fix): a successful restore is the
      // ceremony ADR-041 §3's own text names as how an operator "resolves" a crash-interrupted
      // migration -- so it must actually exit BLOCKED_PENDING_RECOVERY, not just record a ledger
      // row. Terminalize whatever non-terminal migration_runs row exists for this site (if any --
      // a restore can also be run for reasons unrelated to a crash-interrupted migration, in which
      // case there is nothing to resolve) so the next boot's findNonTerminalForSite no longer
      // re-detects it.
      //
      // Round-6 re-audit (TM-adr041-043-044-045-audit-001, codex `R6-F1-RESTART-REQUIRED-RESTORE-
      // UNBLOCKS-STALE-DB`, verified directly against `db-ops.ts`'s own doc comment): the DURABLE
      // resolution (markResolved) and the IN-PROCESS unblock (siteStatus.set) are NOT the same
      // thing and must not be conflated. `SqliteDbOpsAdapter.restoreFromArtifact` always returns
      // `restartRequired: true` for a real file-backed db -- the running process keeps its open
      // file descriptor pointed at the now-unlinked OLD inode until it restarts, so clearing the
      // gate in-process here would let normal traffic resume against stale pre-restore data, with
      // writes accepted in that window silently lost on the eventual restart. Only clear the
      // in-process block when the restore genuinely didn't require one (memory-mode dev, or a
      // future adapter that can restore live) -- when a restart IS required, the durable
      // terminalization above is what makes the NEXT boot resolve to SERVING; the running process
      // stays blocked (correctly) until then.
      const nonTerminal = await input.migrationRunsRepo.findNonTerminalForSite(input.workspaceId);
      if (nonTerminal) {
        await input.migrationRunsRepo.markResolved({ id: nonTerminal.id });
        if (!restartRequired) {
          await input.siteStatus.set(input.workspaceId, "SERVING");
        }
      }

      return { restoreRunId, state: "RESTORED", restartRequired };
    },
    resolveActorClassIdentity: input.resolveActorClassIdentity,
  };
}

/** Looks up the restore point `input.restorePointId` names, throwing `RestorePointNotFoundError`
 *  when it does not exist. @complexity O(n) in restore points (one `list()` scan). */
async function findRestorePoint(input: Pick<BuildRestoreHooksInput, "restorePointsRepo" | "restorePointId">): Promise<{ id: string; artifactRef: string }> {
  const points = await input.restorePointsRepo.list();
  const target = points.find((p) => p.id === input.restorePointId);
  if (!target) {
    throw new RestorePointNotFoundError(`restore point '${input.restorePointId}' was not found`);
  }
  return target;
}

export type { RecoveryErrorPayload } from "./recovery-orchestrator.js";
import type { RecoveryErrorPayload } from "./recovery-orchestrator.js";

/**
 * Adapts a throwing call against the real (throwing) `core/gated-mutations` gateway into the
 * `Result<T, RecoveryErrorPayload>` shape `features/recovery/recovery-orchestrator.ts`'s
 * `PlanRestoreGatewayPort`/`ConfirmRestoreGatewayPort`/`ExecuteRestoreGatewayPort` all declare —
 * exactly the "Result-wrapped composition-root binding over the real throwing gateway" Session 4's
 * progress-ledger entry named as still-owed future work. Maps each of `gateway.ts`'s typed thrown
 * errors to a stable `code` string; every other error collapses to `INTERNAL_ERROR`.
 */
/** Maps one caught error to its stable `code` string — split out of {@link toRecoveryResult}'s
 *  `catch` block as a whole unit, not just its branchiest arm, since every arm here pays the same
 *  nesting cost inside a `catch`. */
function classifyRecoveryError(err: unknown): RecoveryErrorPayload {
  if (err instanceof ForbiddenError) return { code: err.reasonCode, message: err.message };
  if (err instanceof PlanStaleError) return { code: "PLAN_STALE", message: err.message };
  if (err instanceof TokenExpiredError) return { code: "TOKEN_EXPIRED", message: err.message };
  if (err instanceof TokenAlreadyRedeemedError) return { code: "TOKEN_ALREADY_REDEEMED", message: err.message };
  if (err instanceof RestorePointNotFoundError) return { code: "RESTORE_POINT_NOT_FOUND", message: err.message };
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "internal error" };
}

export async function toRecoveryResult<T>({ run }: { run: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<{ ok: true; value: T } | { ok: false; error: RecoveryErrorPayload }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: classifyRecoveryError(err) };
  }
}
