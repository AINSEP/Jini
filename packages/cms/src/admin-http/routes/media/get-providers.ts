import { defineJsonRoute, ok, routeReply, type RouteReply } from "@jini-ai/core/contracts/server";
import type { AdminMediaProviderMarkers } from "@jini-ai/core/contracts/site/cms-media";

import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/**
 * The redacted read model every provider route answers with: the markers-only map plus the store's
 * opaque revision of it, read together so the revision describes exactly that map. The revision is
 * the host's stored write marker (a counter, a row version) — never a key, and never a digest of
 * key plaintext, because it travels to the browser in a header.
 */
export interface MediaProvidersReadModel {
  providers: AdminMediaProviderMarkers;
  revision: string;
}

/** Reads the workspace's media-generation vendor credentials as markers, with their revision. Injected: the secret store is the host's. */
export type MediaProvidersGetFn = (required: { workspaceId: string }) => Promise<MediaProvidersReadModel>;

/** The response header carrying the read model's revision: a strong ETag. */
export const MEDIA_PROVIDERS_REVISION_RESPONSE_HEADER = "etag";
/** The request header a legacy whole-set PUT carries its last-read revision in; a host mounts the PUT with `readHeaders: ["if-match"]`. */
export const MEDIA_PROVIDERS_REVISION_REQUEST_HEADER = "if-match";

/** ETag-safe opaque revision: visible ASCII without the quote, so it needs no escaping inside the strong tag. */
const HEADER_SAFE_REVISION = /^[\x21\x23-\x7e]{1,200}$/;

/**
 * The provider routes' answer: the bare markers map as the body (the shape existing GET consumers
 * read, unchanged) and the revision as a strong ETag a later whole-set PUT echoes back in `If-Match`.
 * @throws When the host's revision cannot ride in the header as-is — a wiring bug, not caller input.
 * @complexity O(1) for a bounded revision string.
 */
export function mediaProvidersReply({ model }: { model: MediaProvidersReadModel }, _optional: Record<string, never> = {}): RouteReply<AdminMediaProviderMarkers> {
  if (!HEADER_SAFE_REVISION.test(model.revision)) throw new Error("media provider revision is not header-safe");
  return routeReply({ status: 200, body: model.providers, headers: { [MEDIA_PROVIDERS_REVISION_RESPONSE_HEADER]: `"${model.revision}"` } });
}

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
 * The revision rides in the `ETag` header for the same reason: the body stays the map existing
 * consumers already read.
 */
export const mediaGetProvidersRoute = defineJsonRoute<Record<string, never>, RouteReply<AdminMediaProviderMarkers>, MediaGetProvidersRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/providers",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.read" });
    return ok({ value: mediaProvidersReply({ model: await deps.getProviders({ workspaceId: deps.workspaceId }) }) });
  },
});
