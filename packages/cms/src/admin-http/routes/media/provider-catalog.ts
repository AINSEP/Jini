import type { MediaProviderOption } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/** The deps this route reads; `listCatalog` is the host's safe projection of its live registry. */
export interface MediaProviderCatalogRouteDeps {
  workspaceId: string;
  listCatalog: (_required?: Record<string, never>) => readonly MediaProviderOption[];
}

/** The response: the configurable provider cards, enveloped so the client can tell it from the marker map. */
export interface MediaProviderCatalogResponse {
  providers: readonly MediaProviderOption[];
}

/**
 * GET the provider cards the admin "External Providers" tab renders and counts. Read-only and
 * credential-free: it lists vendors, never stored keys (those stay on `GET .../media/providers`).
 * Gated by `media.read`, the same permission as the marker read beside it.
 */
export const mediaProviderCatalogRoute = defineJsonRoute<Record<string, never>, MediaProviderCatalogResponse, MediaProviderCatalogRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers/catalog",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.read" });
    return ok({ value: { providers: deps.listCatalog() } });
  },
});
