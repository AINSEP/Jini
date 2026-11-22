/**
 * @file Decides, once per submission, which bindings receive it and freezes everything a delivery
 * needs into child outbox jobs, except answers: those remain in the source row and are read on
 * each attempt. Binding and form metadata stay frozen across retries and settings edits.
 */
import { FORM_DELIVERY_EVENT, type FormDeliveryBinding, type FormDeliveryReferenceJob, type FormDeliveryPlan,
  type FormDeliveryPlanPort, type FormDeliverySnapshot } from "./types.js";

export interface FormDeliveryPlannerDeps {
  plans: FormDeliveryPlanPort;
  bindings(required: { workspaceId: string }): Promise<readonly FormDeliveryBinding[]>;
  /** Null when the submission or its form no longer exists. */
  snapshot(required: { workspaceId: string; submissionId: string; formId: string }): Promise<FormDeliverySnapshot | null>;
  newId(): string;
  nowIso(): string;
}

/** @param optional.onSourceGone `"retry"` (default) throws so the source outbox job retries; `"empty-plan"` records an
 *  empty plan instead, for a submission or form that is definitively gone — a throw would fail the whole event and
 *  re-run its other subscribers on every retry, for nothing. Only a null snapshot is affected: every other failure still throws.
 *  @param optional.report receives one line (the submission id only; never the form id, answers or workspace). */
export interface PlanFormDeliveriesOptions {
  readonly onSourceGone?: "retry" | "empty-plan";
  readonly report?: (required: { message: string }) => void;
}

/** Bindings selected the submission but its source is gone: retry (throw) or record the empty plan. @complexity O(1). */
function sourceGone(
  required: { workspaceId: string; submissionId: string; formId: string; optional: PlanFormDeliveriesOptions },
  _optional = {},
): FormDeliveryPlan {
  const { workspaceId, submissionId, formId, optional } = required;
  if (optional.onSourceGone !== "empty-plan") {
    throw new Error(`Form delivery planning failed: submission ${submissionId} or form ${formId} was not found; the source event will retry.`);
  }
  optional.report?.({ message: `submission ${submissionId} or its form no longer exists; recorded an empty delivery plan` });
  return { workspaceId, submissionId, formId, jobs: [] };
}

function selects(binding: FormDeliveryBinding, formId: string): boolean {
  return binding.enabled && (binding.formIds === undefined || binding.formIds.includes(formId));
}

/**
 * Returns the submission's delivery plan, building and storing it on first call only. An empty
 * selection still records a plan, so bindings added later never backfill old submissions.
 * @throws Error when bindings select the submission but its source is gone (unless `optional.onSourceGone` is `"empty-plan"`), so the source outbox
 *   job retries instead of recording a plan that silently delivers nothing.
 * @complexity O(bindings × formIds) to select; one job row per selected binding.
 * @example await planFormDeliveries({ deps, workspaceId, submissionId, formId });
 */
export function planFormDeliveries(
  required: { deps: FormDeliveryPlannerDeps; workspaceId: string; submissionId: string; formId: string },
  optional: PlanFormDeliveriesOptions = {},
): Promise<FormDeliveryPlan> {
  const { deps, workspaceId, submissionId, formId } = required;
  const build = async (): Promise<FormDeliveryPlan> => {
    const selected = (await deps.bindings({ workspaceId })).filter(binding => selects(binding, formId));
    if (selected.length === 0) return { workspaceId, submissionId, formId, jobs: [] };
    const source = await deps.snapshot({ workspaceId, submissionId, formId });
    if (!source) return sourceGone({ workspaceId, submissionId, formId, optional });
    // Select only form metadata; whole host rows must never widen the persisted payload.
    const form = { slug: source.form.slug, fields: source.form.fields };
    const occurredAt = deps.nowIso();
    const jobs = selected.map(binding => ({
      id: deps.newId(), name: FORM_DELIVERY_EVENT, workspaceId, aggregateId: submissionId, occurredAt,
      payload: { binding, form, submissionRef: { submissionId, formId }, idempotencyKey: JSON.stringify([submissionId, binding.bindingId]) } satisfies FormDeliveryReferenceJob,
    }));
    return { workspaceId, submissionId, formId, jobs };
  };
  return deps.plans.once({ workspaceId, submissionId, build });
}
