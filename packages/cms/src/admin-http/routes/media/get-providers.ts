import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/** Credentials keyed by provider id, as markers only (a key exists, its last characters) — never key material. */
export type MediaProviderMarkerMap = Readonly<Record<string, object>>;

/** The deps this route reads. The host binds its credential store and secret sealer into the reader. */
export interface MediaGetProvidersRouteDeps {
  workspaceId: string;
  getMediaProviderCredentials: (required: { workspaceId: string }) => Promise<MediaProviderMarkerMap>;
}

/**
 * GET the workspace's media-generation vendor credentials, as markers only — never key material.
 * Answers `MediaProvidersPort.fetchMediaProviders` in `@jini-ai/ui`.
 *
 * Gated by `media.read`, the same permission the rest of this module's read routes use: this is
 * media configuration for the workspace, and an operator who may list assets may see which vendors
 * are wired up (that a key exists and its last 4 characters — not the key).
 *
 * Returns a bare map rather than a `{ data }` envelope, because the port's `fetchMediaProviders`
 * resolves the `MediaProviderMap` directly and `{}` is a meaningful answer ("reached, manages
 * nothing") that must stay distinguishable from the unreachable case the client models as `null`.
 */
export const mediaGetProvidersRoute = defineJsonRoute<Record<string, never>, MediaProviderMarkerMap, MediaGetProvidersRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.read" });
    return ok({ value: await deps.getMediaProviderCredentials({ workspaceId: deps.workspaceId }) });
  },
});
