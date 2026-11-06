/**
 * @file Runs one frozen child job through a push adapter and normalises every outcome into either
 * success or a {@link FormDeliveryError}, so nothing an adapter says reaches the outbox ledger.
 */
import { FormDeliveryError } from "./errors.js";
import type { FormDeliveryJob, FormDeliveryQueuedJob, FormDeliveryResult, FormDeliverySubmissionReader } from "./types.js";

/** Legacy payloads remain readable. Referenced jobs resolve the scoped source before any provider
 * call; a missing source is terminal. One indexed source read per attempt, no retained copy. */
async function hydrate(required: { job: FormDeliveryQueuedJob; workspaceId?: string; readSubmission?: FormDeliverySubmissionReader }): Promise<FormDeliveryJob> {
  const { job, workspaceId, readSubmission } = required;
  if (!("submissionRef" in job)) return job;
  if (!workspaceId || !readSubmission) throw new FormDeliveryError({ code: "configuration-invalid", retryable: false });
  const submission = await readSubmission({ workspaceId, ...job.submissionRef });
  if (!submission || submission.id !== job.submissionRef.submissionId) throw new FormDeliveryError({ code: "delivery-failed", retryable: false });
  return { binding: job.binding, snapshot: { form: job.form, submission: {
    id: submission.id, answers: submission.answers, submittedAt: submission.submittedAt,
  } }, idempotencyKey: job.idempotencyKey };
}

/** Untyped adapters may return anything; only `undefined` (legacy void) and `{ ok: true }` count as success. */
function failureFromResult(result: FormDeliveryResult | void): FormDeliveryError | undefined {
  if (result === undefined) return undefined;
  const untyped = result as { ok?: unknown; error?: unknown } | null;
  if (untyped?.ok === true) return undefined;
  const error = untyped?.error;
  // The constructor re-validates every field, so a malformed plain object is safe to hand over.
  const input = typeof error === "object" && error !== null ? error : { code: "delivery-failed", retryable: true };
  return new FormDeliveryError(input as ConstructorParameters<typeof FormDeliveryError>[0]);
}

/**
 * Delivers one job. One attempt only: the outbox worker owns retries, so the same job (and the
 * same `idempotencyKey`) is simply delivered again.
 * @throws {FormDeliveryError} on any failure; a thrown non-delivery error becomes retryable
 *   `delivery-failed` and is deliberately NOT kept as `cause`, since its text may hold secrets.
 * @example await deliverFormJob({ job: event.payload, deliver: job => adapter.deliver(job) });
 */
export async function deliverFormJob(
  required: { job: FormDeliveryQueuedJob; workspaceId?: string; readSubmission?: FormDeliverySubmissionReader;
    deliver: (job: FormDeliveryJob) => Promise<FormDeliveryResult | void> },
  _optional: Record<string, never> = {},
): Promise<void> {
  let failure: FormDeliveryError | undefined;
  try {
    failure = failureFromResult(await required.deliver(await hydrate(required)));
  } catch (error) {
    failure = error instanceof FormDeliveryError ? error : new FormDeliveryError({ code: "delivery-failed", retryable: true });
  }
  if (failure) throw failure;
}
