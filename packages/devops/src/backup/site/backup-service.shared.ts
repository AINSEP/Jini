import type { CredentialedRepositoryTarget, InspectBackupRepositoryResult, SourceControlProvider } from "../../source-control/site/provider-module.js";
import type { SiteBackupToolDeps, Refusal } from "./backup-service.js";

export const PLAN_TOOL_ID = "site_backup_plan";
export const SITE_BACKUP_PUSH_TOOL_ID = "site_backup_push";
/** How long one push call waits for its job before reporting progress: under the 6-minute cut-off
 *  of a delegated tool call (`push-jobs.ts`), with room for the checks before the upload. */
export const PUSH_WAIT_MS = 4 * 60 * 1000;

export function failureLog(deps: SiteBackupToolDeps): (line: string) => void {
  return deps.siteBackupFailureLog;
}

/** Logs a failure's server-only detail (a network failure's class and code). Never the token. */
export function logFailureDetail({ deps, toolId, failure }: { deps: SiteBackupToolDeps; toolId: string; failure: { readonly code: string; readonly logDetail?: string } }, _optional: Record<string, never> = {}): void {
  if (failure.logDetail !== undefined) failureLog(deps)(`[site-backup] ${toolId}: failed code=${failure.code} detail=${failure.logDetail}`);
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const INSPECT_CODES: Record<string, string> = {
  "repo-not-found": "REPOSITORY_NOT_FOUND",
  "repo-not-private": "REPOSITORY_NOT_PRIVATE",
  "no-push-permission": "NO_PUSH_PERMISSION",
  "repo-empty": "REPOSITORY_EMPTY",
  "branch-not-found": "BRANCH_NOT_FOUND",
  "folder-is-file": "FOLDER_IS_FILE",
  "provider-error": "PROVIDER_ERROR",
  "network-unreachable": "NETWORK_UNREACHABLE",
  diverged: "DIVERGED_BRANCH",
};

/** A provider failure as this tool's `{code, message}`, logging any server-only detail. */
export function providerRefusal({ deps, toolId, failure }: { deps: SiteBackupToolDeps; toolId: string; failure: { readonly code: string; readonly message: string; readonly logDetail?: string } }, _optional: Record<string, never> = {}): Refusal {
  logFailureDetail({ deps, toolId, failure });
  return { ok: false, code: INSPECT_CODES[failure.code] ?? "PROVIDER_ERROR", message: failure.message };
}

export async function inspect(
  { deps, provider, toolId, input }: { deps: SiteBackupToolDeps; provider: SourceControlProvider; toolId: string; input: CredentialedRepositoryTarget & { branch?: string; folder: string } },
  _optional: Record<string, never> = {}
): Promise<Extract<InspectBackupRepositoryResult, { ok: true }> | Refusal> {
  const result = await provider.inspectBackupRepository(input);
  return result.ok ? result : providerRefusal({ deps, toolId, failure: result });
}

