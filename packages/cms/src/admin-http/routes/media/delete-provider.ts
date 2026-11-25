import { defineJsonRoute, ok, type RouteReply } from "@jini-ai/core/contracts/server";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";

import { mediaProvidersReply, type MediaProvidersReadModel } from "./get-providers.js";
import { MEDIA_PROVIDER_ROW_PATH, MEDIA_PROVIDER_WRITE_PERMISSION, providerIdParam, requireProviderId, type MediaProviderRowErrorDeps } from "./provider-row.js";
import { authorizeMedia, rejectMediaError, type MediaRoutePrincipal } from "./shared.js";

/**
 * Deletes exactly one provider's stored credentials in one workspace and answers the redacted read
 * model. Removing a provider that holds nothing is not an error. Injected: the secret store is the host's.
 */
export type MediaProviderRemoveFn = (
  required: { workspaceId: string; providerId: string },
  optional?: Record<string, never>,
) => Promise<MediaProvidersReadModel>;

/** The deps this route reads. */
export interface MediaDeleteProviderRouteDeps extends MediaProviderRowErrorDeps {
  workspaceId: string;
  removeProvider: MediaProviderRemoveFn;
}

/**
 * DELETE one media-generation vendor's credentials. Answers `MediaProviderRowsPort.removeProvider`
 * in `@jini-ai/ui`. Deletion is only ever this explicit request: the provider is named in the path,
 * never inferred from its absence in a map. Same admission as the whole-set PUT, authorized before
 * the credential port runs; the answer is GET's markers-only map with its new revision as the `ETag`.
 */
export const mediaDeleteProviderRoute = defineJsonRoute<{ providerId: string }, RouteReply<AdminMediaProviderMarkers>, MediaDeleteProviderRouteDeps, MediaRoutePrincipal>({
  method: "delete",
  path: MEDIA_PROVIDER_ROW_PATH,
  parse: (raw) => ok({ value: { providerId: providerIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: MEDIA_PROVIDER_WRITE_PERMISSION });
    const providerId = requireProviderId({ providerId: input.providerId });
    try {
      return ok({ value: mediaProvidersReply({ model: await deps.removeProvider({ workspaceId: deps.workspaceId, providerId }) }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: deps.saveErrorMappings, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
