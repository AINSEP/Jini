import { normalizeRepositoryFolder } from "../repository-path.js";
import { repositoryTargetError } from "../repository-target.js";

import type { RepositoryTargetValidator } from "./provider-module.js";

/**
 * @file The commit-target shape check `source_control_execute_commit` runs twice (before its confirmation dialog,
 * and again inside the host's `commitSiteToSourceControl`). Its own file so the host's commit binding stays a thin
 * binding over `@jini-ai/devops/source-control`: that entry's `validateCommitTarget` checks the branch only against its
 * name pattern and never the folder, so this stricter site rule lives here beside it.
 */

/** Git branch name — permissive (real branch names allow far more), but refuses whitespace/control
 *  characters before the value reaches a URL path segment. */
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,250}$/;

/** Git's own ref-name rules for the parts the pattern allows: no `..` anywhere (it would let fetch
 *  normalize `refs/heads/../../x` into another API path called with the user's token), no empty or
 *  dot-led component and no `.lock` component. @complexity O(n) in the (≤250-char) name. */
function isValidBranchName({ branch }: { branch: string }, _optional = {}): boolean {
  return BRANCH_PATTERN.test(branch) && !branch.includes("..")
    && !branch.split("/").some(part => part === "" || part.startsWith(".") || part.endsWith(".lock"));
}
const MAX_COMMIT_MESSAGE_LENGTH = 500;

/**
 * Validates a commit target's shape. Called twice by design: once by `tool-registrations.ts`'s handler
 * BEFORE opening the confirmation dialog (a caller with an invalid target never causes a dialog to be
 * raised — same discipline `deployment_execute_static_publish` applies to its own early
 * `validateStaticPublishConfig` call), and again here, defense-in-depth, for any future caller of
 * {@link commitSiteToSourceControl} that skips the tool layer's own check.
 *
 * Owner/repo rules belong to the host: `validateTarget` is the plugin module's own check, run first,
 * then the generic one-path-segment rule (`repositoryTargetError` in `@jini-ai/devops/source-control`,
 * shared with the other writers).
 *
 * @returns `null` when valid, else a human-readable reason safe to return over a tool-result boundary
 *   (never echoes more than the offending field, capped, never a token — there is none in scope here).
 * @complexity O(1) — a handful of fixed-size regex tests.
 */
export function validateCommitTarget(
  input: { owner: string; repo: string; branch?: string; folder?: string; commitMessage: string },
  { validateTarget }: { validateTarget?: RepositoryTargetValidator } = {},
): string | null {
  // The owner/repo check every source-control write runs before anything is built or sent: this
  // file (`source_control_execute_commit`), `custom_credential_write_files` and `site_backup_plan`.
  // The host's own, stricter rules come first (the plugin module's `validateTarget`, e.g. GitHub's
  // name patterns and its "invalid GitHub owner" text live in the `github` plugin), so a host's
  // refusal reads the same whichever tool hit it. Then one generic rule applies to every host: each
  // value is one URL path segment.
  const targetError = repositoryTargetError({ owner: input.owner, repo: input.repo }, validateTarget ? { validateTarget } : {});
  if (targetError !== null) return targetError;
  try { normalizeRepositoryFolder({ folder: input.folder }); }
  catch (error) { return (error as Error).message; }
  if (input.branch !== undefined && !isValidBranchName({ branch: input.branch })) return `invalid branch name '${input.branch.slice(0, 60)}'`;
  if (input.commitMessage.trim() === "" || input.commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH) {
    return `commitMessage must be 1-${MAX_COMMIT_MESSAGE_LENGTH} characters`;
  }
  return null;
}

