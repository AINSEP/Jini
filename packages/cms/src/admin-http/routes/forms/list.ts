import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { FormDefinitionRepoPort } from "../../../forms/index.js";
import { toAdminFormDefinitionListResponse, type AdminFormDefinitionDto } from "../../http/forms.js";
import { authorizeForms, FORMS_MANAGE, type FormsRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface FormsListRouteDeps {
  workspaceId: string;
  formDefinitionRepo: Pick<FormDefinitionRepoPort, "list">;
}

/** GET the workspace's form definitions (`FORMS_LIST_DEFINITIONS`, api.spec.md §1). */
export const formsListRoute = defineJsonRoute<Record<string, never>, { data: AdminFormDefinitionDto[] }, FormsListRouteDeps, FormsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/forms",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeForms({ authorize, permission: FORMS_MANAGE, entityType: "form_definition" });
    const definitions = await deps.formDefinitionRepo.list({ workspaceId: deps.workspaceId });
    return ok({ value: toAdminFormDefinitionListResponse({ definitions }) });
  },
});
