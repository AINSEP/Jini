import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { routeReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { Clock } from "@jini-ai/core/primitives";

import { deleteFormSubmission, type FormSubmissionRepoPort, type RemoveFormSubmissionFn } from "../../../forms/index.js";
import { resolveFormDefinitionByIdOrSlug, type ResolveFormDefinitionDeps } from "./resolve-definition.js";
import { authorizeForms, formsActorId, rejectFormDefinitionNotFound, rejectFormSubmissionNotFound, routeParam, type FormsRoutePrincipal } from "./shared.js";
import type { FormsSubmissionInput } from "./get-submission.js";

/** The deps this route reads: the definition lookup, the submission repo, the host's Trash binding and clock. */
export interface FormsDeleteSubmissionRouteDeps extends ResolveFormDefinitionDeps {
  formSubmissionRepo: FormSubmissionRepoPort;
  /** Moves one submission to the Trash (bound to the `"form_submission"` type by the host). */
  removeFormSubmission: RemoveFormSubmissionFn;
  clock: Clock;
}

/**
 * DELETE moves one submission to the Trash (`FORMS_DELETE_SUBMISSION`). A submission of another
 * form reads as not-found, same as a missing one (`deleteFormSubmission`).
 */
export const formsDeleteSubmissionRoute = defineJsonRoute<FormsSubmissionInput, ReturnType<typeof routeReply>, FormsDeleteSubmissionRouteDeps, FormsRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId/submissions/:submissionId",
  parse: (raw) => ok({ value: { formId: routeParam(raw.params, "formId"), submissionId: routeParam(raw.params, "submissionId") } }),
  handle: async ({ input, deps, context, authorize }) => {
    const { formId, submissionId } = input;
    const actorId = formsActorId({ context });
    await authorizeForms({ authorize, permission: "admin.forms.submissions.delete", entityType: "form_submission" }, { entityId: submissionId });

    // Slug first, id second — same rationale as `list-submissions.ts`/`get-by-id.ts`: the
    // Submissions tab URL is /admin/forms/:slug, and the admin form editor passes that same route
    // param straight through as `formId` here.
    const definition = await resolveFormDefinitionByIdOrSlug({ deps, formId });
    if (!definition) rejectFormDefinitionNotFound({ formId });

    // Moves it to the Trash; restore or a permanent delete happens from the Trash screen.
    const outcome = await deleteFormSubmission(
      {
        workspaceId: deps.workspaceId,
        form: { id: definition.id, name: definition.name },
        submissionId,
        actor: { principalId: actorId, pluginId: null },
        submissionRepo: deps.formSubmissionRepo, remove: deps.removeFormSubmission, clock: deps.clock,
      },
      {},
    );
    if (!outcome.ok) {
      if (outcome.reason === "not-found") rejectFormSubmissionNotFound({ submissionId });
      rejectRoute({ status: 409, error: `submission '${submissionId}' changed while it was being deleted`, code: "TRASH_VERSION_CHANGED" });
    }
    return ok({ value: routeReply({ status: 204 }) });
  },
});
