import type { RepositoryTarget, RepositoryTargetValidator } from './contracts.js';

const GENERIC_SEGMENT_PATTERN = /^[^\s/\\\x00-\x1f\x7f]{1,100}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,250}$/;
function isGenericSegment(value: string): boolean {
  return GENERIC_SEGMENT_PATTERN.test(value) && !/[\s\x00-\x1f\x7f]/.test(value) && value !== '.' && value !== '..';
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
  if (optional.branch !== undefined && (!BRANCH_PATTERN.test(optional.branch) || /[\s\x00-\x1f\x7f]/.test(optional.branch))) return `invalid branch name '${optional.branch.slice(0, 60)}'`;
  if (required.commitMessage.trim() === '' || required.commitMessage.length > 500) return 'commitMessage must be 1-500 characters';
  return null;
}
