import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/** One vendor's stored credential, as markers only (that a key exists, its last characters) — never key material. */
export type MediaProviderMarkers = Record<string, unknown>;

/** Reads the workspace's media-generation vendor credentials as markers. Injected: the secret store is the host's. */
export type MediaProvidersGetFn = (required: { workspaceId: string }) => Promise<MediaProviderMarkers>;

/** The deps this route reads. */
export interface MediaGetProvidersRouteDeps {
  workspaceId: string;
  getProviders: MediaProvidersGetFn;
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
export const mediaGetProvidersRoute = defineJsonRoute<Record<string, never>, MediaProviderMarkers, MediaGetProvidersRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.read" });
    return ok({ value: await deps.getProviders({ workspaceId: deps.workspaceId }) });
  },
});
