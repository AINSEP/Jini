



import type { SiteBackupPushProgress } from "../push-jobs.js";



import { PUSH_WAIT_MS, SITE_BACKUP_PUSH_TOOL_ID, type SiteBackupToolDeps, type SiteBackupPlan, type Refusal, providerRefusal, inspect, type PushResult } from "./backup-service.js";
import { backupTarget, resolveBackupCredential } from "./backup-service.credentials.js";

function pushRefusal(refusal: Refusal, cancelledCode: string): PushResult {
  return refusal.code === cancelledCode ? { pushed: false, cancelled: false, reason: "abandoned" } : { pushed: false, cancelled: false, code: refusal.code, message: refusal.message };
}

/**
 * The authorized push: re-resolve the credential, re-check the repository (still
 * private, branch not moved), upload, commit on the PLAN's parent. Stopping (`signal`) takes effect
 * between files and before the commit, never half-way through one.
 *
 * @complexity O(total bytes); see Jini's `backup/site/push-content` for the uploads, plus a few fixed tree writes,
 *   one commit and one ref update.
 */
async function pushPlannedBackup({ deps, plan, run }: { deps: SiteBackupToolDeps; plan: SiteBackupPlan; run: { signal: AbortSignal; progress: SiteBackupPushProgress } }, _optional: Record<string, never> = {}): Promise<PushResult> {
  const credential = await resolveBackupCredential({ deps, requested: plan.credentialLabel });
  if (!credential.ok) return pushRefusal(credential, deps.cancelled.code);
  const target = backupTarget({ credential, owner: plan.owner, repo: plan.repo });

  const repo = await inspect({ deps, provider: credential.provider, toolId: PUSH_WAIT_MS, SITE_BACKUP_PUSH_TOOL_ID, input: { ...target, branch: plan.repository.branch, folder: plan.folder } });
  if (!repo.ok) return pushRefusal(repo, deps.cancelled.code);
  if (repo.state.parentCommitSha !== plan.repository.parentCommitSha) {
    return pushRefusal({
      ok: false,
      code: "DIVERGED_BRANCH",
      message: `branch '${plan.repository.branch}' moved since the backup was planned (someone pushed to it). Nothing was written. Call site_backup_plan again.`,
    }, deps.cancelled.code);
  }

  if (plan.credentialWarnings?.length) return pushRefusal({ ok: false, code: "UNSAFE_FILE", message: "The export contains files with possible credentials. Remove the credentials and export again." }, deps.cancelled.code);
  const uploaded = await deps.uploadBackupPlan({
    plan, signal: run.signal, progress: run.progress, ...deps.backupPushUploadPolicy({ plan }),
    uploadBlob: async (file, _optional = {}) => {
      const uploaded = await credential.provider.uploadBackupBlob(target, file);
      return uploaded.ok ? { ok: true, blobSha: uploaded.blob.blobSha } : providerRefusal({ deps, toolId: PUSH_WAIT_MS, SITE_BACKUP_PUSH_TOOL_ID, failure: uploaded });
    },
  }, credential.provider.backupInlineTextMaxBytes === undefined ? {} : { inlineTextMaxBytes: credential.provider.backupInlineTextMaxBytes });
  if (!uploaded.ok) return pushRefusal(uploaded, deps.cancelled.code);
  if (run.signal.aborted) return pushRefusal(deps.cancelled, deps.cancelled.code);

  const committed = await deps.commitBackupPlan({ provider: credential.provider, target, plan, entries: uploaded.entries });
  if (!committed.ok) return pushRefusal(providerRefusal({ deps, toolId: PUSH_WAIT_MS, SITE_BACKUP_PUSH_TOOL_ID, failure: committed }), deps.cancelled.code);
  return committed.result;
}

export async function runObservedBackupPush(required: Parameters<typeof pushPlannedBackup>[0]): Promise<PushResult> {
  if (!required.deps.observability) return pushPlannedBackup(required);
  const operation = required.deps.observability.trackOperation({ name: "site.backup" });
  return operation.run(() => pushPlannedBackup(required)).then(result => {
    const cancelled = !result.pushed && (result.cancelled || ("reason" in result && result.reason === "abandoned"));
    operation.end({ outcome: result.pushed ? "completed" : cancelled ? "cancelled" : "not_pushed", failed: !result.pushed && !cancelled });
    return result;
  }, error => {
    operation.end({ outcome: "failed", failed: true });
    throw error;
  });
}

export const PLAN_TAKE_MESSAGES = {
  PLAN_NOT_FOUND: "no backup plan with that planId is waiting (a planId works once, for this principal, and a server restart drops plans). Call site_backup_plan again.",
  PLAN_EXPIRED: "that backup plan expired (plans last 10 minutes). Call site_backup_plan again.",
} as const;

/** What a call returns while its job is still uploading. */
export function inProgressResult({ formatByteSize, planId, progress, elapsedMs }: { formatByteSize: SiteBackupToolDeps["formatByteSize"]; planId: string; progress: SiteBackupPushProgress; elapsedMs: number }, _optional: Record<string, never> = {}): PushResult {
  return {
    pushed: false,
    cancelled: false,
    inProgress: true,
    planId,
    progress,
    message:
      `Still uploading after ${Math.round(elapsedMs / 1000)} s: ${progress.filesDone} of ${progress.filesTotal} files (${formatByteSize({ bytes: progress.bytesDone })} of ${formatByteSize({ bytes: progress.bytesTotal })}). ` +
      "Nothing is committed until every file is up. Call site_backup_push again with the same planId to keep waiting; it does not start a second upload.",
  };
}

export function pushWaitBudget({ deps, waitMs }: { deps: SiteBackupToolDeps; waitMs: number | undefined }, _options = {}): number {
  return waitMs ?? deps.siteBackupPushWaitMs ?? PUSH_WAIT_MS;
}