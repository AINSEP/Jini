import type { SourceControlCredential } from "../../source-control/models.js";
import type { GitBackupPlan, GitBackupPlanInput, GitBackupPushResult, GitBackupRefusal } from "./hooks/git-backup-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Pure decisions for the Git backup card: which connections it can use, what the form sends,
 * and the plain line a refusal shows.
 */

export interface GitBackupForm {
  connection: string;
  owner: string;
  repo: string;
  branch: string;
}

export const EMPTY_GIT_BACKUP_FORM: GitBackupForm = { connection: "", owner: "", repo: "", branch: "" };

/** Only a host's DEFAULT connection is one a backup can push with (the server backup service's
 *  `resolveHostConnection`), so only those are offered. @complexity O(connections). */
export function backupConnectionLabels({ credentials }: { credentials: readonly Pick<SourceControlCredential, "isDefault" | "label">[] }, _optional: Record<string, never> = {}): string[] {
  return [...new Set(credentials.filter((credential) => credential.isDefault).map((credential) => credential.label))];
}

/** Owner, repository and a connection are required; the branch is optional. */
export function gitBackupFormReady(form: GitBackupForm, _optional: Record<string, never> = {}): boolean {
  return form.connection !== "" && form.owner.trim() !== "" && form.repo.trim() !== "";
}

/** The plan request: trimmed, a blank branch left out so the server uses the default branch. */
export function gitBackupPlanInput(form: GitBackupForm, _optional: Record<string, never> = {}): GitBackupPlanInput {
  const branch = form.branch.trim();
  return { credential: form.connection, owner: form.owner.trim(), repo: form.repo.trim(), ...(branch ? { branch } : {}) };
}

export function isGitBackupPlan(result: GitBackupPlan | GitBackupRefusal, _optional: Record<string, never> = {}): result is GitBackupPlan {
  return result.planned === true;
}

export function isGitBackupInProgress(result: GitBackupPushResult, _optional: Record<string, never> = {}): result is Extract<GitBackupPushResult, { inProgress: true }> {
  return "inProgress" in result && result.inProgress === true;
}

export function isGitBackupPushed(result: GitBackupPushResult, _optional: Record<string, never> = {}): result is Extract<GitBackupPushResult, { pushed: true }> {
  return result.pushed === true;
}

/** The server's messages for these codes address the assistant ("call site_backup_plan again"), so
 *  the card says the same thing in its own words. Any other code's message is already plain. */
const REFUSAL_KEYS: Record<string, string> = {
  PLAN_EXPIRED: "The plan expired. Plan again.",
  PLAN_NOT_FOUND: "That plan is gone. Plan again.",
  DIVERGED_BRANCH: "The branch changed since the plan. Nothing was written. Plan again.",
  CREDENTIAL_NOT_FOUND: "That connection is gone. Check Source Control.",
};

/** The one line a refusal shows. @complexity O(1). */
export function gitBackupRefusalMessage({ result, t }: { result: GitBackupRefusal; t: Translate }, _optional: Record<string, never> = {}): string {
  if (result.reason !== undefined || result.cancelled) return t("The backup stopped. Nothing was committed. Plan again.");
  const key = result.code === undefined ? undefined : REFUSAL_KEYS[result.code];
  if (key) return t(key);
  return result.message ?? t("Git backup failed.");
}
