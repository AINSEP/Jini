import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { authorizeMedia, rejectMediaError, type MediaErrorMapping, type MediaRoutePrincipal } from "./shared.js";

/** Replaces the workspace's whole credential set and answers the same markers-only map GET returns. Injected: the secret store is the host's. */
export type MediaProvidersSaveFn = (required: { workspaceId: string; providers: Record<string, unknown> }) => Promise<AdminMediaProviderMarkers>;

/** The deps this route reads. */
export interface MediaPutProvidersRouteDeps {
  workspaceId: string;
  saveProviders: MediaProvidersSaveFn;
  /** Words a classified host store error for the caller (see {@link OutwardErrorMessage}); a mapping with its own fixed `error` copy keeps it. */
  outwardErrorMessage: OutwardErrorMessage;
  /** The host's refusals for its own store errors, in order (validation 400, unconfigured store 503 with the
   *  host's operator copy). The error classes and that copy are the host's, so the table is too. */
  saveErrorMappings: readonly MediaErrorMapping[];
}

/**
 * PUT the workspace's media-generation vendor credentials as a WHOLE SET. Answers
 * `MediaProvidersPort.saveMediaProviders` in `@jini-ai/ui`.
 *
 * Body is the provider map itself (`{ "openai": { apiKey?, baseUrl?, model? }, … }`), not a wrapped
 * envelope — matching the port's signature. A provider absent from the body is DELETED: the tab
 * sends its entire local map and expresses a cleared credential as an omission, so treating absence
 * as "leave alone" would make Clear silently do nothing.
 *
 * Gated by `admin.integrations.manage`, the same permission every other vendor-credential route in
 * this codebase uses (connectors, commerce, external-mcp, and the webhook-subscription routes in
 * `015-integrations.yaml`) — not `media.write`, which is deprecated and no longer granted to fresh
 * admin roles, so it would silently lock new admins out of a feature legacy admins can still reach.
 *
 * The response never echoes key material — it is the same markers-only map GET returns. Three
 * failure outcomes, mirroring `put-site-credential.ts`'s split: 400 validation (unknown provider
 * id, wrong field type, oversized field), 503 `SECRET_STORE_UNCONFIGURED` (missing
 * site key, detected before any write lands), 500 everything else.
 */
export const mediaPutProvidersRoute = defineJsonRoute<{ providers: Record<string, unknown> }, AdminMediaProviderMarkers, MediaPutProvidersRouteDeps, MediaRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: (raw) => ok({ value: { providers: (raw.body ?? {}) as Record<string, unknown> } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "admin.integrations.manage" });
    try {
      return ok({ value: await deps.saveProviders({ workspaceId: deps.workspaceId, providers: input.providers }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: deps.saveErrorMappings, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
