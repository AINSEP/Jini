/**
 * @file The safety order for updating a live site: owner approval, backup, migration readiness
 * gate, deploy, live check, and rollback to the kept previous version when the check fails.
 * Pure orchestration over injected ports; no network, no clock, no globals.
 */
import type { IdGenerator } from '@jini-ai/core/primitives';
import {
  compareSiteVersions, SiteUpdateError,
  type MigrationReadinessPort, type SiteBackupPort, type SiteUpdateApproval, type SiteUpdateOutcome,
  type SiteUpdatePlan, type SiteUpdatePort, type SiteUpdateStep, type SiteUpdateStepLog, type SiteUpdateStepStatus,
} from './contracts.js';

/** Everything `runSiteUpdate` calls. `ids` mints the `ERR-` id of every failure the owner sees. */
export interface SiteUpdatePorts {
  site: SiteUpdatePort;
  backup: SiteBackupPort;
  readiness: MigrationReadinessPort;
  ids: IdGenerator;
}

/** Options of {@link runSiteUpdate}. */
export interface RunSiteUpdateOptions {
  /** Cancels the update before it writes; never reaches the rollback (see `rollbackSignal`). */
  signal?: AbortSignal | undefined;
  /**
   * The rollback's own lifetime, e.g. a host deadline. Deliberately separate from `signal`: the run is
   * usually cancelled exactly when something went wrong, and a rollback that honoured that cancellation
   * would leave the owner's site on a broken half-deployed version. Omitted means no deadline.
   */
  rollbackSignal?: AbortSignal | undefined;
}

/** What happened, in plain words, with the full step log. */
export interface SiteUpdateRunResult {
  outcome: SiteUpdateOutcome;
  summary: string;
  steps: SiteUpdateStepLog[];
  /** Present only when the update landed and passed its live check. */
  changes?: SiteUpdatePlan;
  /** Present once a backup exists, so the owner can always restore from it. */
  backupId?: string;
  errorId?: string;
}

/**
 * What a host persists between preparing and finishing an update. The process that accepted the update
 * may not be the one that verifies it: a desktop or self-hosted replacement restarts the very process
 * that ran the approval, backup and readiness gate.
 */
export interface PreparedSiteUpdate {
  plan: SiteUpdatePlan;
  backupId: string;
  steps: readonly SiteUpdateStepLog[];
}

/** Result of {@link prepareSiteUpdate}: ready for the host to replace the site, or stopped with the inline result. */
export type SiteUpdatePreparation =
  | { status: 'prepared'; prepared: PreparedSiteUpdate }
  | { status: 'stopped'; result: SiteUpdateRunResult };

/** How the host-driven replacement ended, as observed by the process that finishes the update. */
export type PreparedSiteUpdateApply = { status: 'landed'; summary: string } | { status: 'failed' };

/** The ports {@link finishPreparedSiteUpdate} may use: only the live check and the rollback. */
export interface FinishSiteUpdatePorts {
  site: Pick<SiteUpdatePort, 'verifyUpdate' | 'rollback'>;
  ids: IdGenerator;
}

interface RunContext<P = SiteUpdatePorts> {
  ports: P;
  plan: SiteUpdatePlan;
  signal: AbortSignal | undefined;
  rollbackSignal: AbortSignal | undefined;
  steps: SiteUpdateStepLog[];
}

type Finish = Omit<SiteUpdateRunResult, 'steps'>;

function log(ctx: RunContext<unknown>, step: SiteUpdateStep, status: SiteUpdateStepStatus, detail: string): void {
  ctx.steps.push({ step, status, detail });
}

function finish(ctx: RunContext<unknown>, result: Finish): SiteUpdateRunResult {
  return { ...result, steps: ctx.steps };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refuse(ctx: RunContext<unknown>, detail: string, errorId?: string): SiteUpdateRunResult {
  log(ctx, 'approval', 'refused', detail);
  return finish(ctx, { outcome: 'refused', summary: detail, ...(errorId ? { errorId } : {}) });
}

/** "Never auto-update": the owner's token must exist, name an approver, and match this exact version. */
function checkApproval(ctx: RunContext<Pick<SiteUpdatePorts, 'ids'>>, approval: SiteUpdateApproval | undefined): SiteUpdateRunResult | null {
  const { plan } = ctx;
  if (!approval || approval.kind !== 'owner-approval' || approval.approvedBy.trim() === '') {
    return refuse(ctx, 'The owner has not approved this update, so nothing was changed.');
  }
  if (approval.toVersion !== plan.toVersion) {
    return refuse(ctx, `The owner approved ${approval.toVersion}, not ${plan.toVersion}, so nothing was changed.`);
  }
  try {
    if (compareSiteVersions({ left: plan.toVersion, right: plan.fromVersion }, { ids: ctx.ports.ids }) <= 0) {
      return refuse(ctx, `${plan.toVersion} is not newer than the running ${plan.fromVersion}, so nothing was changed.`);
    }
  } catch (error) {
    if (!(error instanceof SiteUpdateError)) throw error;
    return refuse(ctx, error.message, error.errorId);
  }
  log(ctx, 'approval', 'done', `Approved by ${approval.approvedBy} for ${plan.toVersion}.`);
  return null;
}

/** Checked before every step that writes, so a cancelled update never starts one. */
function stopIfAborted(ctx: RunContext<unknown>, step: SiteUpdateStep, before: string, backupId?: string): SiteUpdateRunResult | null {
  if (!ctx.signal?.aborted) return null;
  const detail = `Stopped before ${before} because the update was cancelled. The site was not changed.`;
  log(ctx, step, 'skipped', detail);
  return finish(ctx, { outcome: 'aborted', summary: detail, ...(backupId ? { backupId } : {}) });
}

async function backupStep(ctx: RunContext<Pick<SiteUpdatePorts, 'backup' | 'ids'>>): Promise<{ backupId: string } | SiteUpdateRunResult> {
  const stopped = stopIfAborted(ctx, 'backup', 'the backup');
  if (stopped) return stopped;
  try {
    const { backupId } = await ctx.ports.backup.createBackup({ fromVersion: ctx.plan.fromVersion }, { signal: ctx.signal });
    log(ctx, 'backup', 'done', `Backup ${backupId} made of ${ctx.plan.fromVersion}.`);
    return { backupId };
  } catch (error) {
    const errorId = ctx.ports.ids.newId();
    const summary = `${errorId}: The backup could not be made, so nothing was changed. ${messageOf(error)}`;
    log(ctx, 'backup', 'failed', summary);
    return finish(ctx, { outcome: 'failed', summary, errorId });
  }
}

/**
 * The gate between backup and deploy: a blocked or broken check means nothing is deployed. The check
 * is told which backup exists and which version it was taken of, so it can judge the data that backup covers.
 */
async function readinessStep(ctx: RunContext<Pick<SiteUpdatePorts, 'readiness' | 'ids'>>, backupId: string): Promise<SiteUpdateRunResult | null> {
  try {
    const readiness = await ctx.ports.readiness.check(
      { toVersion: ctx.plan.toVersion },
      { signal: ctx.signal, backupId, fromVersion: ctx.plan.fromVersion },
    );
    if (readiness.status === 'ok') {
      log(ctx, 'readiness', 'done', `Stored data is ready for ${ctx.plan.toVersion}.`);
      return null;
    }
    log(ctx, 'readiness', 'blocked', readiness.reason);
    return finish(ctx, { outcome: 'blocked', summary: `Not updated: ${readiness.reason}`, backupId });
  } catch (error) {
    const errorId = ctx.ports.ids.newId();
    const summary = `${errorId}: The readiness check could not run, so nothing was deployed. ${messageOf(error)}`;
    log(ctx, 'readiness', 'failed', summary);
    return finish(ctx, { outcome: 'failed', summary, backupId, errorId });
  }
}

interface RollbackCause { what: string; summary: string; errorId?: string }

/**
 * Puts the kept previous version back. Deliberately NOT gated on, nor given, the run's abort signal:
 * by now the new version is (maybe half) live and failing, and stopping here would leave the owner's
 * site broken. It runs under its own `rollbackSignal` lifetime instead.
 */
async function rollbackStep(ctx: RunContext<{ site: Pick<SiteUpdatePort, 'rollback'>; ids: IdGenerator }>, backupId: string, cause: RollbackCause): Promise<SiteUpdateRunResult> {
  const to = ctx.plan.fromVersion;
  const idPart = cause.errorId ? { errorId: cause.errorId } : {};
  try {
    await ctx.ports.site.rollback({ to, backupId }, { signal: ctx.rollbackSignal });
    log(ctx, 'rollback', 'done', `Back on ${to}.`);
    return finish(ctx, { outcome: 'rolled-back', summary: cause.summary, backupId, ...idPart });
  } catch (error) {
    const errorId = cause.errorId ?? ctx.ports.ids.newId();
    const summary = `${errorId}: ${cause.what} and going back to ${to} also failed. Restore backup ${backupId} by hand.`;
    log(ctx, 'rollback', 'failed', `${summary} ${messageOf(error)}`);
    return finish(ctx, { outcome: 'rollback-failed', summary, backupId, errorId });
  }
}

async function verifyStep(ctx: RunContext<FinishSiteUpdatePorts>, backupId: string): Promise<SiteUpdateRunResult> {
  const { plan } = ctx;
  let reason: string | null;
  try {
    const verification = await ctx.ports.site.verifyUpdate({ plan }, { signal: ctx.signal });
    reason = verification.status === 'healthy' ? null : verification.reason;
  } catch (error) {
    // A live check that cannot run proves nothing about the new version, so it counts as a failure.
    reason = messageOf(error);
  }
  if (reason !== null) {
    log(ctx, 'verify', 'failed', reason);
    const summary = `The new version did not pass its live check (${reason}), so the site was rolled back to ${plan.fromVersion}.`;
    return rollbackStep(ctx, backupId, { what: 'The new version failed its live check', summary });
  }
  log(ctx, 'verify', 'done', `The live site works on ${plan.toVersion}.`);
  const notes = plan.notes.trim() ? ` What changed: ${plan.notes.trim()}` : '';
  return finish(ctx, { outcome: 'updated', summary: `Updated from ${plan.fromVersion} to ${plan.toVersion}.${notes}`, changes: plan, backupId });
}

async function deployStep(ctx: RunContext, backupId: string): Promise<SiteUpdateRunResult> {
  const stopped = stopIfAborted(ctx, 'apply', 'deploying', backupId);
  if (stopped) return stopped;
  try {
    const { summary } = await ctx.ports.site.applyUpdate({ plan: ctx.plan, backupId }, { signal: ctx.signal });
    log(ctx, 'apply', 'done', summary);
  } catch (error) {
    // The deploy may have half-landed, so a failed apply is undone like a failed live check.
    return applyFailedStep(ctx, backupId, messageOf(error));
  }
  return verifyStep(ctx, backupId);
}

/** Logs a failed apply under a fresh `ERR-` id and undoes it with the kept previous version. */
function applyFailedStep(ctx: RunContext<FinishSiteUpdatePorts>, backupId: string, reason: string): Promise<SiteUpdateRunResult> {
  const errorId = ctx.ports.ids.newId();
  log(ctx, 'apply', 'failed', `${errorId}: ${reason}`);
  const summary = `${errorId}: The deploy failed (${reason}), so the site was rolled back to ${ctx.plan.fromVersion}.`;
  return rollbackStep(ctx, backupId, { what: 'The deploy failed', summary, errorId });
}

/**
 * The first half of an update: owner approval, backup, and the readiness gate. Never applies, verifies
 * or rolls back, so a host can persist the result and replace the site (restarting this process).
 *
 * @param required.ports - Backup, readiness and error-id ports.
 * @param required.plan - The planned move; `fromVersion` is the version kept to roll back to.
 * @param required.approval - The owner's token for exactly `plan.toVersion`; missing means stopped with no port called.
 * @returns `prepared` with the plan, backup id and step log, or `stopped` with the same result `runSiteUpdate` returns.
 * @throws Only what the `ids` port itself throws.
 * @complexity At most two sequential port calls.
 */
export async function prepareSiteUpdate(
  required: { ports: Pick<SiteUpdatePorts, 'backup' | 'readiness' | 'ids'>; plan: SiteUpdatePlan; approval: SiteUpdateApproval | undefined },
  _optional: Pick<RunSiteUpdateOptions, 'signal'> = {},
): Promise<SiteUpdatePreparation> {
  const ctx: RunContext<Pick<SiteUpdatePorts, 'backup' | 'readiness' | 'ids'>> = {
    ports: required.ports, plan: required.plan, signal: _optional.signal, rollbackSignal: undefined, steps: [],
  };
  const refused = checkApproval(ctx, required.approval);
  if (refused) return { status: 'stopped', result: refused };
  const backup = await backupStep(ctx);
  if ('outcome' in backup) return { status: 'stopped', result: backup };
  const blocked = await readinessStep(ctx, backup.backupId);
  if (blocked) return { status: 'stopped', result: blocked };
  return { status: 'prepared', prepared: { plan: required.plan, backupId: backup.backupId, steps: [...ctx.steps] } };
}

/**
 * The second half of an update, after the host replaced the site: the live check, and the rollback to the
 * kept previous version when the replacement failed or the check fails. Resuming must never repeat apply:
 * this has no apply, backup or approval port, and a landed replacement still needs the live check before
 * it counts as updated. Hosts call it only with a durable operation they claimed and reloaded themselves,
 * never with receipt data a request supplied. The rollback runs on `rollbackSignal`, never the caller's signal.
 *
 * @param required.prepared - What {@link prepareSiteUpdate} returned, as the host persisted it; its log is copied, not changed.
 * @param required.ports - The live-check and rollback ports, plus the error-id port.
 * @param required.apply - Whether the host's replacement landed (with what it did) or failed.
 * @returns The outcome, a plain-words summary, the full step log, and on success what changed. Never throws for port failures.
 * @throws Only what the `ids` port itself throws.
 * @complexity At most two sequential port calls.
 */
export async function finishPreparedSiteUpdate(
  required: { prepared: PreparedSiteUpdate; ports: FinishSiteUpdatePorts; apply: PreparedSiteUpdateApply },
  _optional: RunSiteUpdateOptions = {},
): Promise<SiteUpdateRunResult> {
  const { prepared, apply } = required;
  const ctx: RunContext<FinishSiteUpdatePorts> = {
    ports: required.ports, plan: prepared.plan, signal: _optional.signal, rollbackSignal: _optional.rollbackSignal,
    steps: prepared.steps.map((entry) => ({ ...entry })),
  };
  // A confirmed failure may still have half-landed, so it is undone exactly like a failed inline apply.
  if (apply.status === 'failed') return applyFailedStep(ctx, prepared.backupId, 'The new version did not land.');
  log(ctx, 'apply', 'done', apply.summary);
  return verifyStep(ctx, prepared.backupId);
}

/**
 * Updates a live site to `plan.toVersion`, only with the owner's explicit approval for that version.
 *
 * Order: approval -> backup -> migration readiness gate -> apply -> live check -> (rollback to
 * `plan.fromVersion` on a failed apply or check). The abort signal is checked before the backup and
 * before the deploy, and passed to every port call except the rollback, which gets `rollbackSignal`.
 *
 * @param required.ports - Platform, backup, readiness and error-id ports.
 * @param required.plan - The planned move; `fromVersion` is the version kept to roll back to.
 * @param required.approval - The owner's token for exactly `plan.toVersion`; missing means refused with no port called.
 * @returns The outcome, a plain-words summary, the step log, and on success what changed. Never throws for port failures.
 * @throws Only what the `ids` port itself throws: with no way to mint an id, no failure could be reported.
 * @complexity At most five sequential port calls.
 */
export async function runSiteUpdate(
  required: { ports: SiteUpdatePorts; plan: SiteUpdatePlan; approval: SiteUpdateApproval | undefined },
  _optional: RunSiteUpdateOptions = {},
): Promise<SiteUpdateRunResult> {
  const preparation = await prepareSiteUpdate(
    { ports: required.ports, plan: required.plan, approval: required.approval },
    { signal: _optional.signal },
  );
  if (preparation.status === 'stopped') return preparation.result;
  const { prepared } = preparation;
  const ctx: RunContext = {
    ports: required.ports, plan: prepared.plan, signal: _optional.signal, rollbackSignal: _optional.rollbackSignal, steps: [...prepared.steps],
  };
  return deployStep(ctx, prepared.backupId);
}
