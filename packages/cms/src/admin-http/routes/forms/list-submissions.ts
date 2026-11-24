import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { FormSubmissionRepoPort } from "../../../forms/index.js";
import { toAdminFormSubmissionListResponse } from "../../http/forms.js";
import { resolveFormDefinitionByIdOrSlug, type ResolveFormDefinitionDeps } from "./resolve-definition.js";
import { authorizeForms, rejectFormDefinitionNotFound, routeParam, type FormsRoutePrincipal } from "./shared.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/** The deps this route reads. */
export interface FormsListSubmissionsRouteDeps extends ResolveFormDefinitionDeps {
  formSubmissionRepo: Pick<FormSubmissionRepoPort, "listByDefinition">;
}

/** The `:formId` param plus the raw `?limit=`/`?cursor=` values, validated only after the
 *  authorization and definition lookup (the hand-written route's precedence). */
export interface FormsListSubmissionsInput { formId: string; limit: unknown; cursor: unknown }

/** Parsed+validated `?limit=`/`?cursor=` pair, or the reason validation failed. */
type ParsedSubmissionsQuery =
  | { readonly ok: true; readonly limit: number; readonly cursor: string | undefined }
  | { readonly ok: false; readonly error: string; readonly field: string; readonly reason: string };

/**
 * Parses and validates `?limit=`/`?cursor=` in one place — `limit` must be an integer in
 * `[MIN_LIMIT, MAX_LIMIT]`, defaulting to `DEFAULT_LIMIT` when omitted; `cursor`, if present, must
 * be a string.
 *
 * @complexity O(1).
 */
function parseSubmissionsQuery(query: { limit: unknown; cursor: unknown }): ParsedSubmissionsQuery {
  const rawLimit = query.limit !== undefined ? Number(query.limit) : DEFAULT_LIMIT;
  if (!Number.isInteger(rawLimit) || rawLimit < MIN_LIMIT || rawLimit > MAX_LIMIT) {
    return {
      ok: false,
      error: `limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`,
      field: "limit",
      reason: `must be ${MIN_LIMIT}-${MAX_LIMIT}`,
    };
  }
  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    return { ok: false, error: "cursor must be a string", field: "cursor", reason: "must be a string" };
  }
  return { ok: true, limit: rawLimit, cursor: query.cursor as string | undefined };
}

/** GET submissions for a form definition, newest-first (`FORMS_LIST_SUBMISSIONS`, REQ-13). */
export const formsListSubmissionsRoute = defineJsonRoute<FormsListSubmissionsInput, ReturnType<typeof toAdminFormSubmissionListResponse>, FormsListSubmissionsRouteDeps, FormsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId/submissions",
  parse: (raw) => ok({ value: { formId: routeParam(raw.params, "formId"), limit: raw.query.limit, cursor: raw.query.cursor } }),
  handle: async ({ input, deps, authorize }) => {
    const { formId } = input;
    await authorizeForms({ authorize, permission: "admin.forms.submissions.read", entityType: "form_submission" });

    // Slug first, id second — the Submissions tab URL is /admin/forms/:slug, and
    // the admin form editor passes that same route param straight through as `formId` here (see
    // `resolve-definition.ts`), same as the sibling GET-by-id route already does.
    const definition = await resolveFormDefinitionByIdOrSlug({ deps, formId });
    if (!definition) rejectFormDefinitionNotFound({ formId });

    const parsedQuery = parseSubmissionsQuery(input);
    if (!parsedQuery.ok) {
      throw new RouteRefusalError({ status: 400, body: {
        error: parsedQuery.error,
        code: "FORMS_FIELD_VALIDATION_ERROR",
        details: { fieldErrors: [{ field: parsedQuery.field, reason: parsedQuery.reason }] },
      } });
    }

    const page = await deps.formSubmissionRepo.listByDefinition({
      workspaceId: deps.workspaceId,
      formDefinitionId: definition.id,
      limit: parsedQuery.limit,
    }, parsedQuery.cursor === undefined ? {} : { cursor: parsedQuery.cursor });
    return ok({ value: toAdminFormSubmissionListResponse(page) });
  },
});
