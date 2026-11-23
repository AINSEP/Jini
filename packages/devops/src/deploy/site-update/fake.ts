/**
 * @file An in-memory `SiteUpdatePort` for tests and demos. It holds a running version, the
 * versions the site has run, the published releases and the existing backups, and fails the
 * steps its world scripts. It follows the same safety rules a real adapter must (see
 * `./contract.ts`), so the shared contract suite runs against it unchanged.
 */
import { mintToolErrorId } from '@jini-ai/core/errors/error-id';
import type {
  SiteUpdateApplyResult,
  SiteUpdateApproval,
  SiteUpdatePlan,
  SiteUpdatePort,
  SiteUpdateRefusalReason,
  SiteUpdateRefused,
  SiteUpdateStepKind,
  SiteUpdateStepOutcome,
  SiteUpdateStepStatus,
} from './contract.js';

/** The world the fake starts in. */
export interface FakeSiteUpdateWorld {
  readonly runningVersion: string;
  /** Published releases, oldest first; the last one is the latest. */
  readonly releases: readonly { readonly version: string; readonly notes: string }[];
  /** Backup ids that exist. */
  readonly backups: readonly string[];
  /** Steps that fail during `applyUpdate`, each with the plain reason it reports. `rollback` makes the restore fail too. */
  readonly failures?: { readonly readiness?: string; readonly deploy?: string; readonly verify?: string; readonly rollback?: string };
}

export interface FakeSiteUpdateOptions {
  /** Returns a fresh `ERR-XXXX-XXXX-XXXX-XXXX`. Defaults to a per-fake counter, so ids are deterministic. */
  readonly mintErrorId?: () => string;
}

interface FakeState {
  running: string;
  readonly ran: Set<string>;
  readonly plans: Map<string, SiteUpdatePlan>;
  readonly world: FakeSiteUpdateWorld;
  readonly mintErrorId: () => string;
}

type ApplyRequest = Parameters<SiteUpdatePort['applyUpdate']>[0];

const STEP_ORDER: readonly SiteUpdateStepKind[] = ['backup', 'readiness', 'deploy', 'verify'];

function counterErrorIds(): () => string {
  let next = 0;
  // A counter stands in for the host's random source: tests get stable, distinct ids.
  return () => mintToolErrorId({ randomHex: ({ bytes }) => (++next).toString(16).padStart(bytes * 2, '0') });
}

function refused(state: FakeState, reason: SiteUpdateRefusalReason, words: string): SiteUpdateRefused {
  const errorId = state.mintErrorId();
  return { status: 'refused', reason, errorId, message: `${errorId}: ${words}` };
}

/** Outcomes for each step: `done` up to the failed one, `failed` there, `skipped` after. */
function outcomes(failedAt?: SiteUpdateStepKind): SiteUpdateStepOutcome[] {
  const cut = failedAt === undefined ? STEP_ORDER.length : STEP_ORDER.indexOf(failedAt);
  return STEP_ORDER.map((kind, index): SiteUpdateStepOutcome => {
    const status: SiteUpdateStepStatus = index < cut ? 'done' : index === cut ? 'failed' : 'skipped';
    return { kind, status };
  });
}

const approvalProblem = (approval: SiteUpdateApproval, plan: SiteUpdatePlan): boolean =>
  approval.planId !== plan.planId || approval.approvedBy !== 'human' || approval.receipt.trim() === '';

/** The first safety rule the request breaks, checked before anything changes. */
function refusalFor(state: FakeState, { plan, backupId, approval }: ApplyRequest): SiteUpdateRefused | undefined {
  if (approval === null) return refused(state, 'approval_missing', 'The update needs a person to approve this plan first; nothing was changed.');
  if (approvalProblem(approval, plan)) return refused(state, 'approval_mismatch', 'The approval was given for a different plan; review and approve this plan.');
  if (!state.plans.has(plan.planId)) return refused(state, 'unknown_plan', 'This plan was not made here; plan the update again.');
  if (plan.fromVersion !== state.running) return refused(state, 'stale_plan', `The site no longer runs ${plan.fromVersion}; plan the update again.`);
  if (!state.world.backups.includes(backupId)) return refused(state, 'backup_missing', `Backup ${backupId} does not exist; take a backup before updating.`);
  return undefined;
}

/** Deploy or verify failed: restore `plan.fromVersion`, or report that the restore failed too. */
function restore(state: FakeState, plan: SiteUpdatePlan, failedStep: 'deploy' | 'verify', why: string): SiteUpdateApplyResult {
  const errorId = state.mintErrorId();
  const steps = outcomes(failedStep);
  const restoreFailure = state.world.failures?.rollback;
  if (restoreFailure !== undefined) {
    return { status: 'rollback_failed', failedStep, runningVersion: state.running, steps, errorId, message: `${errorId}: The ${failedStep} step failed (${why}) and restoring ${plan.fromVersion} failed too (${restoreFailure}); the site needs a person.` };
  }
  state.running = plan.fromVersion;
  return { status: 'rolled_back', failedStep, runningVersion: state.running, steps, errorId, message: `${errorId}: The ${failedStep} step failed (${why}), so the site was restored to ${plan.fromVersion}.` };
}

function runSteps(state: FakeState, plan: SiteUpdatePlan): SiteUpdateApplyResult {
  const failures = state.world.failures ?? {};
  if (failures.readiness !== undefined) {
    const errorId = state.mintErrorId();
    return { status: 'blocked', failedStep: 'readiness', runningVersion: state.running, steps: outcomes('readiness'), errorId, message: `${errorId}: The update to ${plan.toVersion} was stopped before deploying: ${failures.readiness}` };
  }
  if (failures.deploy !== undefined) return restore(state, plan, 'deploy', failures.deploy);
  state.running = plan.toVersion;
  state.ran.add(plan.toVersion);
  if (failures.verify !== undefined) return restore(state, plan, 'verify', failures.verify);
  return { status: 'updated', runningVersion: state.running, steps: outcomes() };
}

function buildPlan(state: FakeState, required: { runningVersion: string; targetVersion: string; notes: string }): SiteUpdatePlan {
  const { runningVersion, targetVersion, notes } = required;
  const plan: SiteUpdatePlan = {
    planId: `plan-${state.plans.size + 1}`,
    fromVersion: runningVersion,
    toVersion: targetVersion,
    notes,
    steps: [
      { kind: 'backup', description: 'Confirm the backup taken for this update exists.' },
      { kind: 'readiness', description: `Check the data migrations of ${targetVersion} can run on the current data.` },
      { kind: 'deploy', description: `Replace ${runningVersion} with ${targetVersion}.` },
      { kind: 'verify', description: `Check the site runs ${targetVersion} and answers; restore ${runningVersion} if not.` },
    ],
  };
  state.plans.set(plan.planId, plan);
  return plan;
}

/**
 * Builds an in-memory {@link SiteUpdatePort}.
 *
 * @param required - The starting world: running version, releases, backups and scripted failures.
 * @param _optional.mintErrorId - The error-id port; defaults to a deterministic counter.
 * @returns A port whose state lives in this closure only.
 */
export function createFakeSiteUpdatePort(required: FakeSiteUpdateWorld, _optional: FakeSiteUpdateOptions = {}): SiteUpdatePort {
  const state: FakeState = {
    running: required.runningVersion,
    ran: new Set([required.runningVersion]),
    plans: new Map(),
    world: required,
    mintErrorId: _optional.mintErrorId ?? counterErrorIds(),
  };
  return {
    async checkForUpdate({ runningVersion }) {
      const latest = required.releases.at(-1);
      return latest === undefined || latest.version === runningVersion ? null : { latest: latest.version, notes: latest.notes };
    },
    async planUpdate({ runningVersion, targetVersion }) {
      const release = required.releases.find(candidate => candidate.version === targetVersion);
      if (release === undefined) return refused(state, 'unknown_version', `Version ${targetVersion} was never released; nothing was planned.`);
      return { status: 'planned', plan: buildPlan(state, { runningVersion, targetVersion, notes: release.notes }) };
    },
    async applyUpdate(request) {
      const refusal = refusalFor(state, request);
      return refusal === undefined ? runSteps(state, request.plan) : { ...refusal, steps: [] };
    },
    async verifyUpdate({ expectedVersion }) {
      if (state.running === expectedVersion) return { status: 'passed', runningVersion: state.running };
      const errorId = state.mintErrorId();
      return { status: 'failed', runningVersion: state.running, errorId, message: `${errorId}: The site runs ${state.running}, not ${expectedVersion}.` };
    },
    async rollback({ to, approval }) {
      if (approval === null) return refused(state, 'approval_missing', `Restoring ${to} needs a person to approve it first; nothing was changed.`);
      if (approval.to !== to || approval.approvedBy !== 'human' || approval.receipt.trim() === '') {
        return refused(state, 'approval_mismatch', `The approval was given for restoring ${approval.to}, not ${to}; nothing was changed.`);
      }
      if (!state.ran.has(to)) return refused(state, 'unknown_version', `This site never ran ${to}, so it cannot be restored to it; nothing was changed.`);
      state.running = to;
      return { status: 'rolled_back', runningVersion: to };
    },
  };
}
