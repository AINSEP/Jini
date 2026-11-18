import { ToolInputError, optionalString, requireInputRecord, requireString, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/args.js";
import { DELIVERY_STATUS_MAX_LIMIT } from "./delivery-status-limits.js";
import { FormDefinitionNotFoundError, FormSubmissionNotFoundError } from "./errors.js";
import type { FormSubmissionRecord } from "./types.js";
import type { FormsHandlerArgs, FormsToolDeliveryStatusRow } from "./tool-handlers.types.js";

const SUBMISSIONS_DEFAULT_LIMIT = 50;
const SUBMISSIONS_MIN_LIMIT = 1;
const SUBMISSIONS_MAX_LIMIT = 100;

/** What a submission tool returns to the model — see {@link toFormSubmissionView}. */
interface FormSubmissionToolView {
  id: string;
  formDefinitionId: string;
  data: FormSubmissionRecord["data"];
  sourceIp: string;
  submittedAt: string;
}

/**
 * Projects a `FormSubmissionRecord` into the explicit model-facing shape, the same discipline
 * `toFormDefinitionView` applies just above. `workspaceId` is dropped for the identical reason —
 * the agent is already scoped to one workspace it cannot change. `sourceIp` is deliberately KEPT:
 * it is the same field value the human admin submissions screen already displays under this same
 * `admin.forms.submissions.read` permission (see `agent-tools.ts`'s file header), not a new
 * exposure this tool introduces.
 *
 * @param record - The submission as the domain returned it.
 * @returns The model-facing view, with `data` copied so a tool caller cannot mutate domain state
 * through the returned object.
 * @complexity O(f) in the submission's field count.
 * @overallScore 100
 */
function toFormSubmissionView(record: FormSubmissionRecord): FormSubmissionToolView {
  return {
    id: record.id,
    formDefinitionId: record.formDefinitionId,
    data: { ...record.data },
    // cms-forms 0.2.2 types an expired IP as null; this view keeps repo.rows.ts's empty string.
    sourceIp: record.sourceIp ?? "",
    submittedAt: record.submittedAt,
  };
}

/** Reads and range-checks `limit`, mirroring the host's admin submissions route's own check.
 *  `forms_list_submissions` has no `withSchemaOnRejection` wrap (unlike the three definition tools
 *  below), so this throws `ToolInputError` directly rather than a domain error class a predicate
 *  would need to recognize — same shape every other unwrapped ad-hoc validator in this codebase
 *  uses (e.g. the taxonomy tools' `termIds` check). */
function requireSubmissionsLimit(input: Record<string, unknown>): number {
  if (input.limit === undefined) return SUBMISSIONS_DEFAULT_LIMIT;
  const limit = input.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < SUBMISSIONS_MIN_LIMIT || limit > SUBMISSIONS_MAX_LIMIT) {
    throw new ToolInputError({ message: `'limit' must be an integer between ${SUBMISSIONS_MIN_LIMIT} and ${SUBMISSIONS_MAX_LIMIT}` });
  }
  return limit;
}

/** Reads `limit` for the unfinished-deliveries listing; same unwrapped `ToolInputError` shape as
 *  {@link requireSubmissionsLimit}. */
function requireDeliveryStatusLimit(input: Record<string, unknown>): number {
  const limit = input.limit ?? DELIVERY_STATUS_MAX_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > DELIVERY_STATUS_MAX_LIMIT) {
    throw new ToolInputError({ message: `'limit' must be an integer between 1 and ${DELIVERY_STATUS_MAX_LIMIT}` });
  }
  return limit;
}

/** Copies only the reported fields, so whatever else a status row carries (now or later) never
 *  reaches the model. Error codes are already the allowlisted delivery codes. */
function toDeliveryStatusView(row: FormsToolDeliveryStatusRow): FormsToolDeliveryStatusRow {
  return { bindingId: row.bindingId, adapterId: row.adapterId, formId: row.formId, submissionId: row.submissionId,
    status: row.status, attempts: row.attempts, nextRetryAt: row.nextRetryAt, errorCode: row.errorCode };
}


export const formsListSubmissionsHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const formId = requireString({ input, key: "formId" });
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.submissions.read",
    }, { entityType: "form_submission" });

    const definition = await deps.formDefinitionRepo.findById({ workspaceId: deps.workspaceId, id: formId });
    // The shared typed class reaches the model through the host's explicit not-found allowlist.
    // A bare Error cannot match that allowlist without broadening it to expose every error.
    if (!definition) throw new FormDefinitionNotFoundError({ message: `form definition '${formId}' was not found` });

    const limit = requireSubmissionsLimit(input);
    // A non-string cursor is refused, not read as "no cursor" and page 1 (the HTTP route already refuses it).
    const cursor = optionalString({ input, key: "cursor" });
    const page = await deps.formSubmissionRepo.listByDefinition({
      workspaceId: deps.workspaceId,
      formDefinitionId: formId,
      limit,
    }, cursor === undefined ? {} : { cursor });
    return { submissions: page.items.map(toFormSubmissionView), nextCursor: page.nextCursor };
};

export const formsGetSubmissionHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const formId = requireString({ input, key: "formId" });
    const submissionId = requireString({ input, key: "submissionId" });
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.submissions.read",
    }, { entityType: "form_submission", entityId: submissionId });

    const submission = await deps.formSubmissionRepo.findById({ workspaceId: deps.workspaceId, id: submissionId });
    if (!submission || submission.formDefinitionId !== formId) {
      // Same reasoning as `forms_list_submissions` above. Note this arm deliberately answers
      // "not found" for a submission that EXISTS under a different definition — the cross-form
      // probe is refused with the same text as a genuine miss, and surfacing the real reason
      // does not change that: the message names only the id the caller already supplied.
      throw new FormSubmissionNotFoundError({ message: `submission '${submissionId}' was not found` });
    }
    return { submission: { ...toFormSubmissionView(submission), ...(submission.evidence ? { evidence: submission.evidence } : {}), ...(submission.validation ? { validation: submission.validation } : {}) } };
};

export const formsDeliveryStatusHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const submissionId = optionalString({ input, key: "submissionId" });
    const limit = requireDeliveryStatusLimit(input);
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.submissions.read",
    }, { entityType: "form_submission", ...(submissionId ? { entityId: submissionId } : {}) });
    const status = deps.formDeliveryStatus;
    if (!status) throw new ToolInputError({ message: "Form delivery status is not available on this site's server. Restart the site, then try again." });
    const workspaceId = deps.workspaceId;
    const rows = submissionId ? await status.forSubmission({ workspaceId, submissionId }) : await status.recentUnfinished({ workspaceId }, { limit });
    return { deliveries: rows.map(toDeliveryStatusView) };
};

export const formsPullSubmissionsHandler = ({ deps }: FormsHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const targetId = optionalString({ input, key: "targetId" });
    await requireToolPermission({
      authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
      workspaceId: deps.workspaceId,
      principalId: ctx.principal.id,
      permission: "admin.forms.manage",
    }, { entityType: "form_submission" });
    if (!deps.formSubmissionsPull) {
      throw new ToolInputError({ message: "Pulling form submissions is not available on this site's server. Restart the site, then try again." });
    }
    return deps.formSubmissionsPull.pull({ workspaceId: deps.workspaceId }, targetId ? { targetId } : {});
};
