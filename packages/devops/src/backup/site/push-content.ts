import { uploadPlannedContent, type PendingFile, type UploadPlannedContentInput } from "../upload.node.js";
import type { SiteBackupPushProgress } from "../push-jobs.js";
import type { CommitBackupTreeInput, CredentialedRepositoryTarget, SourceControlProvider } from "../../source-control/site/provider-module.js";
import type { BackupRepositoryState } from "../../source-control/contracts.js";
import type { CredentialWarning } from "./credential-warnings.js";
import type { PlannedDiskFile } from "./sources.js";

export interface BackupUploadPlan {
  readonly files: readonly PlannedDiskFile[];
  readonly database: { readonly bytes: Uint8Array } | null;
  readonly totalBytes: number;
}

export interface BackupPushResult {
  pushed: true;
  commitSha: string;
  commitUrl: string;
  repository: string;
  branch: string;
  folder: string;
  credentialWarnings: readonly CredentialWarning[];
  filesWritten: number;
  totalBytes: number;
}

/** The progress a plan starts from. @complexity O(1). */
export function initialPushProgress({ plan }: { plan: BackupUploadPlan }, _optional: Record<string, never> = {}): SiteBackupPushProgress {
  return { filesDone: 0, filesTotal: plan.files.length + (plan.database ? 1 : 0), bytesDone: 0, bytesTotal: plan.totalBytes };
}

/** The plan's files in order: the database snapshot first, then each disk file, re-read at upload. */
function pendingFiles({ plan, databasePath, readPlannedFile }: Pick<Parameters<typeof uploadBackupPlan>[0], "plan" | "databasePath" | "readPlannedFile">, _optional: Record<string, never> = {}): PendingFile[] {
  const database = plan.database;
  const fromDisk = plan.files.map((file): PendingFile => ({
    path: file.path,
    load: async (_required = {}, _optional = {}) => {
      const read = await readPlannedFile({ file });
      return read.ok ? { ok: true, bytes: read.bytes } : { ok: false, code: "PLAN_STALE", message: read.message };
    },
  }));
  if (!database) return fromDisk;
  return [{ path: databasePath, load: async (_required = {}, _optional = {}) => ({ ok: true, bytes: database.bytes }) }, ...fromDisk];
}

/** Upload the database and deferred disk files, then the repository-format manifest.
 * @complexity O(total bytes); bounded uploads are owned by the shared engine. */
export function uploadBackupPlan(
  { plan, uploadBlob, signal, progress, databasePath, readPlannedFile, buildManifest, cancelled }: {
    plan: BackupUploadPlan; uploadBlob: UploadPlannedContentInput["uploadBlob"]; signal: AbortSignal; progress: SiteBackupPushProgress;
    databasePath: string;
    readPlannedFile: (required: { file: PlannedDiskFile }, optional?: Record<string, never>) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }>;
    buildManifest: UploadPlannedContentInput["buildManifest"];
    cancelled: UploadPlannedContentInput["cancelled"];
  },
  optional: { inlineTextMaxBytes?: number; concurrency?: number } = {},
): ReturnType<typeof uploadPlannedContent> {
  return uploadPlannedContent({
    files: pendingFiles({ plan, databasePath, readPlannedFile }), signal, progress, cancelled, uploadBlob,
    buildManifest,
  }, optional);
}

export async function commitBackupPlan(
  { provider, target, plan, entries }: { provider: Pick<SourceControlProvider, "commitBackupTree">; target: CredentialedRepositoryTarget;
    plan: { owner: string; repo: string; folder: string; commitMessage: string; repository: BackupRepositoryState; credentialWarnings?: readonly CredentialWarning[] }; entries: CommitBackupTreeInput["entries"] },
  _optional: Record<string, never> = {},
): Promise<{ ok: true; result: BackupPushResult } | Exclude<Awaited<ReturnType<SourceControlProvider["commitBackupTree"]>>, { ok: true }>> {
  const committed = await provider.commitBackupTree({
    ...target,
    branch: plan.repository.branch,
    folder: plan.folder,
    commitMessage: plan.commitMessage,
    parentCommitSha: plan.repository.parentCommitSha,
    baseTreeSha: plan.repository.baseTreeSha,
    htmlUrl: plan.repository.htmlUrl,
    entries: entries,
  });
  if (!committed.ok) return committed;
  return {
    ok: true,
    result: {
      pushed: true,
      commitSha: committed.commitSha,
      commitUrl: committed.commitUrl,
      repository: `${plan.owner}/${plan.repo}`,
      branch: plan.repository.branch,
      folder: plan.folder,
      credentialWarnings: plan.credentialWarnings ?? [],
      filesWritten: entries.length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  } satisfies { ok: true; result: BackupPushResult };
}
