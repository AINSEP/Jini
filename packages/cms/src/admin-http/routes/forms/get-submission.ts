import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { FormSubmissionRepoPort } from "../../../forms/index.js";
import { toAdminFormSubmissionResponse } from "../../http/forms.js";
import { resolveFormDefinitionByIdOrSlug, type ResolveFormDefinitionDeps } from "./resolve-definition.js";
import { authorizeForms, rejectFormDefinitionNotFound, rejectFormSubmissionNotFound, routeParam, type FormsRoutePrincipal } from "./shared.js";

/** The host's notification delivery summary for one submission: counts only, never recipient
 *  addresses, answers, or provider exception text. */
export interface FormsDeliveryStatusSummaryPort {
  notificationSummary?(required: { workspaceId: string; submissionId: string }, optional?: Record<string, never>): Promise<{ failed: number; pending: number }>;
}

/** The deps this route reads. */
export interface FormsGetSubmissionRouteDeps extends ResolveFormDefinitionDeps {
  formSubmissionRepo: Pick<FormSubmissionRepoPort, "findById">;
  formDeliveryStatus?: FormsDeliveryStatusSummaryPort | undefined;
}

/** The `:formId` (slug or id) and `:submissionId` params. */
export interface FormsSubmissionInput { formId: string; submissionId: string }

type SubmissionResponse = ReturnType<typeof toAdminFormSubmissionResponse>;

/**
 * Looks up a submission and confirms it belongs to `definitionId` — a real submission id scoped to
 * a DIFFERENT form must read as not-found here, same as an id that doesn't exist at all. Extracted
 * from the route handler below so the `||` this comparison needed collapses to a single `if` at the
 * call site (cyclomatic-complexity gate, not a behavior change — see the host's forms-submissions
 * cross-form-mismatch regression test for the behavior this preserves).
 */
async function findSubmissionScopedToDefinition({ deps, definitionId, submissionId }: { deps: Pick<FormsGetSubmissionRouteDeps, "workspaceId" | "formSubmissionRepo">; definitionId: string; submissionId: string }, _optional = {}) {
  const submission = await deps.formSubmissionRepo.findById({ workspaceId: deps.workspaceId, id: submissionId });
  return submission && submission.formDefinitionId === definitionId ? submission : undefined;
}

/** Add the submission's notification delivery summary when this host reports one. */
async function withNotificationDelivery({ deps, response, submissionId }: {
  deps: Pick<FormsGetSubmissionRouteDeps, "workspaceId" | "formDeliveryStatus">; response: SubmissionResponse; submissionId: string;
}, _options = {}) {
  if (deps.formDeliveryStatus?.notificationSummary) response.data.notificationDelivery = await deps.formDeliveryStatus.notificationSummary({ workspaceId: deps.workspaceId, submissionId });
  return response;
}

/** The `:formId`/`:submissionId` params as the hand-written routes read them. */
const parseSubmissionParams = (params: Record<string, string>): FormsSubmissionInput => ({
  formId: routeParam(params, "formId"), submissionId: routeParam(params, "submissionId"),
});

/** GET one submission's full field values (`FORMS_GET_SUBMISSION`, REQ-13). */
export const formsGetSubmissionRoute = defineJsonRoute<FormsSubmissionInput, SubmissionResponse, FormsGetSubmissionRouteDeps, FormsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId/submissions/:submissionId",
  parse: (raw) => ok({ value: parseSubmissionParams(raw.params) }),
  handle: async ({ input, deps, authorize }) => {
    const { formId, submissionId } = input;
    await authorizeForms({ authorize, permission: "admin.forms.submissions.read", entityType: "form_submission" }, { entityId: submissionId });

    // Slug first, id second — same rationale as `list-submissions.ts`/`get-by-id.ts`: the
    // Submissions tab URL is /admin/forms/:slug, and the admin form editor passes that same route
    // param straight through as `formId` here.
    const definition = await resolveFormDefinitionByIdOrSlug({ deps, formId });
    if (!definition) rejectFormDefinitionNotFound({ formId });

    const submission = await findSubmissionScopedToDefinition({ deps, definitionId: definition.id, submissionId });
    if (!submission) rejectFormSubmissionNotFound({ submissionId });
    return ok({ value: await withNotificationDelivery({ deps, response: toAdminFormSubmissionResponse({ submission }), submissionId }) });
  },
});
