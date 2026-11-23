import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toAdminFormDefinitionResponse, type AdminFormDefinitionDto } from "../../http/forms.js";
import { resolveFormDefinitionByIdOrSlug, type ResolveFormDefinitionDeps } from "./resolve-definition.js";
import { authorizeForms, FORMS_MANAGE, rejectFormDefinitionNotFound, routeParam, type FormsRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export type FormsGetRouteDeps = ResolveFormDefinitionDeps;

/** The `:formId` param: a slug or an id. */
export interface FormsGetInput { formId: string }

/** GET one form definition by id (`FORMS_GET_DEFINITION`, REQ-04). */
export const formsGetRoute = defineJsonRoute<FormsGetInput, { data: AdminFormDefinitionDto }, FormsGetRouteDeps, FormsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/:formId",
  parse: (raw) => ok({ value: { formId: routeParam(raw.params, "formId") } }),
  handle: async ({ input, deps, authorize }) => {
    const { formId } = input;
    await authorizeForms({ authorize, permission: FORMS_MANAGE, entityType: "form_definition" }, { entityId: formId });

    // Admin URLs use the slug when one resolves (ui-fixes-backlog.md #8 — the raw id was
    // unreadable in the URL bar); this route accepts either so an old id-based bookmark/link
    // keeps working. See `resolve-definition.ts` for the slug-first/id-second rationale — now
    // shared with the submissions routes below it, which need the same resolution for the same
    // reason (the admin form editor passes this route's `:formId` param through unchanged to them).
    // Every WRITE below resolves through the loaded record's real `.id` instead of this route
    // param, so the PUT route needs no matching id-or-slug support (see the admin form editor's
    // own comment on its update mutation).
    const definition = await resolveFormDefinitionByIdOrSlug({ deps, formId });
    if (!definition) rejectFormDefinitionNotFound({ formId });
    return ok({ value: toAdminFormDefinitionResponse(definition) });
  },
});
