import type { RepositoryTarget, RepositoryTargetValidator } from './contracts.js';

/** Owner and repo, whatever the host: one URL path segment each, so never empty, never `.`/`..`,
 *  never a slash, whitespace or control character. */
// \s already covers \x09-\x0d, so the control ranges skip them.
const GENERIC_SEGMENT_PATTERN = /^[^\s/\\\x00-\x08\x0e-\x1f\x7f]{1,100}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,250}$/;
function isGenericSegment(value: string): boolean {
  // The pattern itself refuses whitespace and control characters anywhere in the value.
  return GENERIC_SEGMENT_PATTERN.test(value) && value !== '.' && value !== '..';
}
/** Host rules precede the common one-URL-segment rule. Returns caller-safe refusal text. */
export function repositoryTargetError(required: RepositoryTarget, optional: { validateTarget?: RepositoryTargetValidator } = {}): string | null {
  const hostError = optional.validateTarget?.(required) ?? null;
  if (hostError !== null) return hostError;
  if (!isGenericSegment(required.owner)) return `invalid owner '${required.owner.slice(0, 60)}'`;
  if (!isGenericSegment(required.repo)) return `invalid repo '${required.repo.slice(0, 100)}'`;
  return null;
}
/** Validate before resolving credentials or exporting bytes. */
export function validateCommitTarget(required: RepositoryTarget & { commitMessage: string }, optional: { validateTarget?: RepositoryTargetValidator; branch?: string } = {}): string | null {
  const error = repositoryTargetError({ owner: required.owner, repo: required.repo }, optional);
  if (error !== null) return error;
  // BRANCH_PATTERN's allow-list already excludes whitespace and control characters.
  if (optional.branch !== undefined && !BRANCH_PATTERN.test(optional.branch)) return `invalid branch name '${optional.branch.slice(0, 60)}'`;
  if (required.commitMessage.trim() === '' || required.commitMessage.length > 500) return 'commitMessage must be 1-500 characters';
  return null;
}
