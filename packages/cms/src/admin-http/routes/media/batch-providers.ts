import { defineJsonRoute, ok, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";
import { mediaProvidersReply, type MediaProvidersReadModel } from "./get-providers.js";
import { FIELDS_INVALID, requireProviderFields, type MediaProviderFieldsInput } from "./patch-provider.js";
import { MEDIA_PROVIDER_WRITE_PERMISSION, requireProviderId, type MediaProviderRowErrorDeps } from "./provider-row.js";
import { authorizeMedia, rejectMediaError, type MediaRoutePrincipal } from "./shared.js";

export interface MediaBatchProvidersRouteDeps extends MediaProviderRowErrorDeps {
  workspaceId: string;
  applyProviderChanges(required: {
    workspaceId: string;
    removes: readonly string[];
    patches: readonly { providerId: string; fields: MediaProviderFieldsInput }[];
  }, optional?: Record<string, never>): Promise<MediaProvidersReadModel>;
}

export const mediaBatchProvidersRoute = defineJsonRoute<{ body: unknown }, RouteReply<AdminMediaProviderMarkers>, MediaBatchProvidersRouteDeps, MediaRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: raw => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: MEDIA_PROVIDER_WRITE_PERMISSION });
    const body = input.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return rejectRoute(FIELDS_INVALID);
    if (Object.keys(body).some(name => !["removes", "patches"].includes(name))) return rejectRoute(FIELDS_INVALID);
    const changes = body as { removes?: unknown; patches?: unknown };
    if (!Array.isArray(changes.removes) || !Array.isArray(changes.patches)) return rejectRoute(FIELDS_INVALID);
    const removes = changes.removes.map(providerId => {
      if (typeof providerId !== "string") return rejectRoute(FIELDS_INVALID);
      return requireProviderId({ providerId });
    });
    const patches = changes.patches.map(patch => {
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return rejectRoute(FIELDS_INVALID);
      if (Object.keys(patch).some(name => !["providerId", "fields"].includes(name))) return rejectRoute(FIELDS_INVALID);
      const entry = patch as { providerId?: unknown; fields?: unknown };
      if (typeof entry.providerId !== "string") return rejectRoute(FIELDS_INVALID);
      return { providerId: requireProviderId({ providerId: entry.providerId }), fields: requireProviderFields({ body: entry.fields }) };
    });
    try {
      const model = await deps.applyProviderChanges({ workspaceId: deps.workspaceId, removes, patches });
      return ok({ value: mediaProvidersReply({ model }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: deps.saveErrorMappings, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
