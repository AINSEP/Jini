import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { createApiKeyPrincipal } from "../../../identity/api-key-service.js";
import { toApiKeyPrincipalResponse, type AdminApiKeyPrincipalResponse } from "../../http/api-keys.js";
import { rejectUserError, userActorId, type UserRoutePrincipal } from "../users/shared.js";
import { API_KEY_ERRORS, apiKeyBody, type ApiKeyServicesFn } from "./shared.js";

type CreateInput = Parameters<typeof createApiKeyPrincipal>[0]["input"];

/** The deps this route reads. */
export interface ApiKeyPrincipalCreateRouteDeps {
  workspaceId: string;
  apiKeyServices: ApiKeyServicesFn;
  /** Injected service (subpath isolation); the host binds it from `@jini-ai/user-management/identity/api-key-service`. */
  createApiKeyPrincipal: typeof createApiKeyPrincipal;
}

/**
 * POST api-keys/principals — `APIKEY_PRINCIPAL_CREATE` (api.spec §1, 0.7.0). Mints the grantless
 * `kind='api_key'` principal `APIKEY_ISSUE` is required to bind to; before this endpoint existed
 * there was no HTTP path that could produce one, which made issuance unreachable in practice.
 *
 * Not workspace-scoped in its path: the workspace is the caller's own, resolved from the
 * credential, so there is no caller-supplied workspace field and no cross-workspace mint.
 *
 * Gated by `apikey.manage`, enforced inside `createApiKeyPrincipal` rather than here — same
 * placement (and same reason) as `users/create.ts`'s gate living in `grant-service.ts`.
 */
export const apiKeyPrincipalCreateRoute = defineJsonRoute<Pick<CreateInput, "displayName" | "kind">, { principal: AdminApiKeyPrincipalResponse }, ApiKeyPrincipalCreateRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/api-keys/principals",
  parse: (raw) => {
    const body = apiKeyBody(raw);
    return ok({ value: { displayName: body?.displayName, kind: body?.kind } as Pick<CreateInput, "displayName" | "kind"> });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const callerPrincipalId = userActorId({ context });
      const { principal } = await deps.createApiKeyPrincipal({
        deps: deps.apiKeyServices(),
        input: { workspaceId: deps.workspaceId, callerPrincipalId, displayName: input.displayName, kind: input.kind },
      });
      return ok({ value: { principal: toApiKeyPrincipalResponse(principal) } });
    } catch (err) {
      return rejectUserError({ err, rungs: API_KEY_ERRORS });
    }
  },
}, { successStatus: 201 });
