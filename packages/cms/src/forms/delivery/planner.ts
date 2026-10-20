/**
 * @file Decides, once per submission, which bindings receive it and freezes everything a delivery
 * needs into child outbox jobs. Freezing is what makes retries and replays deterministic: later
 * settings edits, answer edits or deletions never change what an already-planned job sends.
 */
import { FORM_DELIVERY_EVENT, type FormDeliveryBinding, type FormDeliveryJob, type FormDeliveryPlan,
  type FormDeliveryPlanPort, type FormDeliverySnapshot } from "./types.js";

export interface FormDeliveryPlannerDeps {
  plans: FormDeliveryPlanPort;
  bindings(required: { workspaceId: string }): Promise<readonly FormDeliveryBinding[]>;
  /** Null when the submission or its form no longer exists. */
  snapshot(required: { workspaceId: string; submissionId: string; formId: string }): Promise<FormDeliverySnapshot | null>;
  newId(): string;
  nowIso(): string;
}

function selects(binding: FormDeliveryBinding, formId: string): boolean {
  return binding.enabled && (binding.formIds === undefined || binding.formIds.includes(formId));
}

/** Copies only the delivered fields, so a host reader that returns a whole stored row (with its
 * source IP, notification settings or anything added later) cannot widen what leaves the site. */
function freeze(snapshot: FormDeliverySnapshot): FormDeliverySnapshot {
  const { form, submission } = snapshot;
  return {
    form: { slug: form.slug, fields: form.fields },
    submission: { id: submission.id, answers: submission.answers, submittedAt: submission.submittedAt },
  };
}

/**
 * Returns the submission's delivery plan, building and storing it on first call only. An empty
 * selection still records a plan, so bindings added later never backfill old submissions.
 * @throws Error when bindings select the submission but its source is gone, so the source outbox
 *   job retries instead of recording a plan that silently delivers nothing.
 * @complexity O(bindings × formIds) to select; one job row per selected binding.
 * @example await planFormDeliveries({ deps, workspaceId, submissionId, formId });
 */
export function planFormDeliveries(
  required: { deps: FormDeliveryPlannerDeps; workspaceId: string; submissionId: string; formId: string },
  _optional: Record<string, never> = {},
): Promise<FormDeliveryPlan> {
  const { deps, workspaceId, submissionId, formId } = required;
  const build = async (): Promise<FormDeliveryPlan> => {
    const selected = (await deps.bindings({ workspaceId })).filter(binding => selects(binding, formId));
    if (selected.length === 0) return { workspaceId, submissionId, formId, jobs: [] };
    const source = await deps.snapshot({ workspaceId, submissionId, formId });
    if (!source) throw new Error(`Form delivery planning failed: submission ${submissionId} or form ${formId} was not found; the source event will retry.`);
    const snapshot = freeze(source);
    const occurredAt = deps.nowIso();
    const jobs = selected.map(binding => ({
      id: deps.newId(), name: FORM_DELIVERY_EVENT, workspaceId, aggregateId: submissionId, occurredAt,
      payload: { binding, snapshot, idempotencyKey: JSON.stringify([submissionId, binding.bindingId]) } satisfies FormDeliveryJob,
    }));
    return { workspaceId, submissionId, formId, jobs };
  };
  return deps.plans.once({ workspaceId, submissionId, build });
}
