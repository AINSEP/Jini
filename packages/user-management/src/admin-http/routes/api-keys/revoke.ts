import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { revokeApiKey } from "../../../identity/api-key-service.js";
import { rejectUserError, userActorId, type UserRoutePrincipal } from "../users/shared.js";
import { API_KEY_ERRORS, type ApiKeyServicesFn } from "./shared.js";

/** The deps this route reads. */
export interface ApiKeyRevokeRouteDeps {
  workspaceId: string;
  apiKeyServices: ApiKeyServicesFn;
  /** Injected service (subpath isolation); the host binds it from `@jini-ai/user-management/identity/api-key-service`. */
  revokeApiKey: typeof revokeApiKey;
}

/**
 * POST api-keys/:id/revoke — `APIKEY_REVOKE` (api.spec §1, state.spec §3 `REVOKE_API_KEY`).
 * Revocation takes effect immediately: `authenticateApiKey` reads `revokedAt` on every request, so
 * the next request presenting the key is rejected with no cache to wait out.
 *
 * Idempotent by design — re-revoking an already-revoked key is a 204, not a 409, so a client that
 * retries a timed-out revoke never has to distinguish "it worked" from "it already had".
 *
 * 204 with no body (api.spec §3), mirroring `users/reset-password.ts`. The `?? ""` fallback on the
 * `:id` segment is kept: Express always fills a matched param, but a direct handler call can omit it
 * and must still answer the ordinary not-found.
 */
export const apiKeyRevokeRoute = defineJsonRoute<{ keyId: string }, undefined, ApiKeyRevokeRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/api-keys/:id/revoke",
  parse: (raw) => ok({ value: { keyId: String(raw.params.id ?? "") } }),
  handle: async ({ input, deps, context }) => {
    try {
      const callerPrincipalId = userActorId({ context });
      await deps.revokeApiKey({ deps: deps.apiKeyServices(), input: { workspaceId: deps.workspaceId, callerPrincipalId, keyId: input.keyId } });
      return ok({ value: undefined });
    } catch (err) {
      return rejectUserError({ err, rungs: API_KEY_ERRORS });
    }
  },
}, { successStatus: 204 });
