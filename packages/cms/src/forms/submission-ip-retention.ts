/**
 * Submission metadata retention, independent of databases and host scheduling.
 * Answers and submission identity are never deleted by this maintenance operation.
 */

/**
 * Owner decision 2026-10-04: retain form submitter IPs for 90 days for abuse investigation,
 * then remove them automatically. Matches the privacy wording: "IP addresses on form
 * submissions are deleted after 90 days"; this is not expiry of the submission itself.
 */
export const SUBMISSION_IP_RETENTION_DAYS = 90;

export interface SubmissionIpRetentionPort {
  /**
   * Clear only sourceIp to NULL for at most limit rows submitted at/before the ISO UTC cutoff.
   * Include all workspaces and Trash rows. Perform one atomic guarded update; return actual
   * affected rows, excluding already-NULL values. Concurrent passes must be idempotent.
   */
  clearExpiredIps(
    required: { submittedBeforeOrAt: string },
    optional?: { limit?: number },
  ): Promise<number>;
}

/** A complete pass, using bounded updates and one fixed cutoff even across multiple batches. */
export async function sweepExpiredSubmissionIps(
  { now, repo }: { now: number; repo: SubmissionIpRetentionPort },
  { batchSize = 500 }: { batchSize?: number } = {},
): Promise<number> {
  const cutoff = now - SUBMISSION_IP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(now) || !Number.isFinite(new Date(cutoff).getTime())) throw new RangeError("submission IP sweep needs a valid timestamp");
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new RangeError("submission IP sweep batchSize must be a positive integer");
  const submittedBeforeOrAt = new Date(cutoff).toISOString();
  let total = 0;
  let cleared: number;
  do {
    cleared = await repo.clearExpiredIps({ submittedBeforeOrAt }, { limit: batchSize });
    total += cleared;
  } while (cleared === batchSize);
  return total;
}
