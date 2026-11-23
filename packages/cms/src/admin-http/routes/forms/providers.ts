import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createFormCollectionRegistry, describeFormCollectionProviders, type FormCollectionRegistry } from "../../../forms/index.js";
import { formsActorId, FORMS_MANAGE, type FormsRoutePrincipal } from "./shared.js";

/** The deps this route reads. `authorize` is the host's RBAC decision itself (not the guard port):
 *  this route answers its own 403 copy, so it reads the decision rather than letting the port refuse. */
export interface FormsProvidersRouteDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  formCollectionProviders?: (() => FormCollectionRegistry) | undefined;
}

/** List public settings from the same current registry the assistant uses; no vendor or database I/O.
 * Registered before the form-id route so the discovery name cannot resolve as a form slug.
 * @complexity O(p) time/space for registered providers and their bounded public descriptions. */
export const formsProvidersRoute = defineJsonRoute<Record<string, never>, { data: ReturnType<typeof describeFormCollectionProviders> }, FormsProvidersRouteDeps, FormsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/_providers",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const principalId = formsActorId({ context });
    const auth = await deps.authorize({ principalId, permission: FORMS_MANAGE, workspaceId: deps.workspaceId, entityType: "form_definition" });
    if (!auth.allowed) {
      rejectRoute({ status: 403, error: "You do not have permission to view form provider settings.", code: "FORBIDDEN", details: { permission: FORMS_MANAGE, reason: auth.reason } });
    }
    return ok({ value: { data: describeFormCollectionProviders({ providers: deps.formCollectionProviders?.() ?? createFormCollectionRegistry({}) }) } });
  },
});
