/**
 * @file The vendor-neutral contract for updating a deployed site from production: find a newer
 * release, plan the update, apply an approved plan, verify it, and roll back.
 *
 * The owner's safety rules are part of the contract, not left to each implementation:
 *
 * 1. **Never auto-update.** `applyUpdate` takes a required `approval` key. `null` (no approval yet)
 *    is refused, and an approval only counts for the one plan it names. The receipt comes from
 *    the host's approval card, which a person answers: replacing the live site is a destructive
 *    action, so `approvedBy` is the literal `'human'` and an agent cannot mint one by itself.
 * 2. **Backup first.** `applyUpdate` names the backup taken for this update. An adapter refuses
 *    before touching anything when that backup does not exist, and `backup` is always step one.
 * 3. **Migration readiness gate.** Step two checks the new version's data migrations can run on the
 *    current data. When it fails the update is `blocked` and the deploy step never runs.
 * 4. **Rollback on failure.** A failed deploy or verify step restores the version that was running
 *    and reports `rolled_back`. `rollback_failed` means the site may be broken and needs a person.
 *
 * Every refusal or failure carries an `errorId` (`ERR-XXXX-XXXX-XXXX-XXXX`, minted through the
 * host's id port as `mintToolErrorId` in `@jini-ai/core/errors/error-id` does) and a `message`
 * that starts with it and continues in plain words, so the id survives when only text is kept.
 * Statuses are plain string values, so a host can store and show them without this package.
 */

/** A newer release than the one running. */
export interface SiteUpdateAvailable {
  readonly latest: string;
  /** Release notes of `latest`, in plain words, for the approval card. */
  readonly notes: string;
}

/** The four steps of every update, always in this order. */
export type SiteUpdateStepKind = 'backup' | 'readiness' | 'deploy' | 'verify';

export interface SiteUpdatePlanStep {
  readonly kind: SiteUpdateStepKind;
  /** What the step will do, in plain words, for the approval card. */
  readonly description: string;
}

/** A plan the adapter issued. It is only valid while `fromVersion` is still the running version. */
export interface SiteUpdatePlan {
  /** Adapter-issued id; an approval binds to it. */
  readonly planId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  /** Always `backup`, `readiness`, `deploy`, `verify`. */
  readonly steps: readonly SiteUpdatePlanStep[];
  readonly notes: string;
}

/**
 * The receipt of a person approving one plan on the host's approval card. The host checks the
 * receipt against its own card store before calling; the adapter checks it names this plan.
 */
export interface SiteUpdateApproval {
  readonly planId: string;
  /** Opaque receipt from the host's approval card. */
  readonly receipt: string;
  /** Only a person may approve replacing a live site. */
  readonly approvedBy: 'human';
}

/**
 * The receipt of a person approving a rollback to one version. Restoring an older version replaces
 * the live site, so it is a destructive action and needs its own approval card, like an update.
 */
export interface SiteUpdateRollbackApproval {
  /** The version the person approved restoring. */
  readonly to: string;
  /** Opaque receipt from the host's approval card. */
  readonly receipt: string;
  readonly approvedBy: 'human';
}

/** Why a request was refused before anything changed. */
export type SiteUpdateRefusalReason =
  | 'approval_missing'
  | 'approval_mismatch'
  | 'backup_missing'
  | 'stale_plan'
  | 'unknown_plan'
  | 'unknown_version';

/** A refusal: nothing was changed. */
export interface SiteUpdateRefused {
  readonly status: 'refused';
  readonly reason: SiteUpdateRefusalReason;
  readonly errorId: string;
  /** Starts with `errorId`, then plain words. */
  readonly message: string;
}

export type SiteUpdatePlanResult = { readonly status: 'planned'; readonly plan: SiteUpdatePlan } | SiteUpdateRefused;

/** `skipped` means the step never ran, e.g. `deploy` after a failed readiness check. */
export type SiteUpdateStepStatus = 'done' | 'failed' | 'skipped';

export interface SiteUpdateStepOutcome {
  readonly kind: SiteUpdateStepKind;
  readonly status: SiteUpdateStepStatus;
}

interface SiteUpdateRan {
  /** The version live when `applyUpdate` returned. */
  readonly runningVersion: string;
  /** One outcome per plan step, in plan order. */
  readonly steps: readonly SiteUpdateStepOutcome[];
}

interface SiteUpdateFailure extends SiteUpdateRan {
  readonly errorId: string;
  /** Starts with `errorId`, then plain words. */
  readonly message: string;
}

/**
 * What `applyUpdate` did. `updated`: the new version runs and verified. `blocked`: the readiness
 * check failed and nothing was deployed. `rolled_back`: deploy or verify failed and the previous
 * version runs again. `rollback_failed`: restoring failed too; a person must look at the site.
 * A refusal carries no steps and no running version, because nothing ran.
 */
export type SiteUpdateApplyResult =
  | (SiteUpdateRan & { readonly status: 'updated' })
  | (SiteUpdateFailure & { readonly status: 'blocked'; readonly failedStep: 'readiness' })
  | (SiteUpdateFailure & { readonly status: 'rolled_back' | 'rollback_failed'; readonly failedStep: 'deploy' | 'verify' })
  | (SiteUpdateRefused & { readonly runningVersion?: undefined; readonly steps: readonly [] });

export type SiteUpdateVerifyResult =
  | { readonly status: 'passed'; readonly runningVersion: string }
  | { readonly status: 'failed'; readonly runningVersion: string; readonly errorId: string; readonly message: string };

export type SiteUpdateRollbackResult = { readonly status: 'rolled_back'; readonly runningVersion: string } | SiteUpdateRefused;

/**
 * The port a host implements per hosting setup (a vendor adapter lives in a host-owned plugin).
 * Every method takes one required arguments object, as the rest of this package does.
 */
export interface SiteUpdatePort {
  /** The latest release when it differs from `runningVersion`; `null` when there is nothing newer. */
  checkForUpdate(required: { readonly runningVersion: string }): Promise<SiteUpdateAvailable | null>;
  /** Builds a plan without changing anything. Refuses (`unknown_version`) a version that was never released. */
  planUpdate(required: { readonly runningVersion: string; readonly targetVersion: string }): Promise<SiteUpdatePlanResult>;
  /**
   * Runs an approved plan: confirm backup, readiness gate, deploy, verify, rolling back on a
   * failed deploy or verify. `approval: null` is refused (`approval_missing`); there is no way to
   * apply without a person's approval of this exact plan.
   */
  applyUpdate(required: {
    readonly plan: SiteUpdatePlan;
    /** The backup taken for this update; must exist before anything changes. */
    readonly backupId: string;
    readonly approval: SiteUpdateApproval | null;
  }): Promise<SiteUpdateApplyResult>;
  /** Checks the live site runs `expectedVersion` and answers healthily. Changes nothing. */
  verifyUpdate(required: { readonly expectedVersion: string }): Promise<SiteUpdateVerifyResult>;
  /**
   * Restores a version this site ran before. Refuses (`unknown_version`) any other version: a
   * rollback never moves to a version the site has not run. `approval: null` is refused
   * (`approval_missing`) and an approval for another version is refused (`approval_mismatch`):
   * replacing the live site always needs a person's approval card.
   */
  rollback(required: { readonly to: string; readonly approval: SiteUpdateRollbackApproval | null }): Promise<SiteUpdateRollbackResult>;
}
