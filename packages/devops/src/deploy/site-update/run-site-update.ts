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

interface RunContext {
  ports: SiteUpdatePorts;
  plan: SiteUpdatePlan;
  signal: AbortSignal | undefined;
  rollbackSignal: AbortSignal | undefined;
  steps: SiteUpdateStepLog[];
}

type Finish = Omit<SiteUpdateRunResult, 'steps'>;

function log(ctx: RunContext, step: SiteUpdateStep, status: SiteUpdateStepStatus, detail: string): void {
  ctx.steps.push({ step, status, detail });
}

function finish(ctx: RunContext, result: Finish): SiteUpdateRunResult {
  return { ...result, steps: ctx.steps };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refuse(ctx: RunContext, detail: string, errorId?: string): SiteUpdateRunResult {
  log(ctx, 'approval', 'refused', detail);
  return finish(ctx, { outcome: 'refused', summary: detail, ...(errorId ? { errorId } : {}) });
}

/** "Never auto-update": the owner's token must exist, name an approver, and match this exact version. */
function checkApproval(ctx: RunContext, approval: SiteUpdateApproval | undefined): SiteUpdateRunResult | null {
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
function stopIfAborted(ctx: RunContext, step: SiteUpdateStep, before: string, backupId?: string): SiteUpdateRunResult | null {
  if (!ctx.signal?.aborted) return null;
  const detail = `Stopped before ${before} because the update was cancelled. The site was not changed.`;
  log(ctx, step, 'skipped', detail);
  return finish(ctx, { outcome: 'aborted', summary: detail, ...(backupId ? { backupId } : {}) });
}

async function backupStep(ctx: RunContext): Promise<{ backupId: string } | SiteUpdateRunResult> {
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

/** The gate between backup and deploy: a blocked or broken check means nothing is deployed. */
async function readinessStep(ctx: RunContext, backupId: string): Promise<SiteUpdateRunResult | null> {
  try {
    const readiness = await ctx.ports.readiness.check({ toVersion: ctx.plan.toVersion }, { signal: ctx.signal });
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
async function rollbackStep(ctx: RunContext, backupId: string, cause: RollbackCause): Promise<SiteUpdateRunResult> {
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

async function verifyStep(ctx: RunContext, backupId: string): Promise<SiteUpdateRunResult> {
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
    const errorId = ctx.ports.ids.newId();
    log(ctx, 'apply', 'failed', `${errorId}: ${messageOf(error)}`);
    const summary = `${errorId}: The deploy failed (${messageOf(error)}), so the site was rolled back to ${ctx.plan.fromVersion}.`;
    return rollbackStep(ctx, backupId, { what: 'The deploy failed', summary, errorId });
  }
  return verifyStep(ctx, backupId);
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
  const ctx: RunContext = {
    ports: required.ports, plan: required.plan, signal: _optional.signal, rollbackSignal: _optional.rollbackSignal, steps: [],
  };
  const refused = checkApproval(ctx, required.approval);
  if (refused) return refused;
  const backup = await backupStep(ctx);
  if ('outcome' in backup) return backup;
  const blocked = await readinessStep(ctx, backup.backupId);
  if (blocked) return blocked;
  return deployStep(ctx, backup.backupId);
}
