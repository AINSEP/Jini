import { defineJsonRoute, ok, type JsonRouteSpec, type RouteInputContext } from "@jini-ai/core/contracts/server";
import type { AdminMediaListEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MediaRecord } from "../../../media/types.js";
import { toAdminMediaListResponse } from "../../http/media.js";
import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/** The library tab a list request reads: images/video (`media`) or uploaded documents (`document`). */
export type MediaListKind = "media" | "document";

/** One batch lookup over the listed assets, keyed as `toAdminMediaListResponse` reads it. */
export type MediaListLookup<Value> = (required: { media: readonly MediaRecord[] }) => Promise<ReadonlyMap<string, Value>>;

/** The deps this route reads; the host injects its media repo read and its three batch lookups. */
export interface MediaListRouteDeps {
  workspaceId: string;
  /** Every asset of the kind in the workspace, all statuses (active + trashed). */
  listMedia: (required: { workspaceId: string; kind: MediaListKind }) => Promise<MediaRecord[]>;
  /** Recorded content type by blob sha256. */
  resolveContentTypes: MediaListLookup<string>;
  /** Public `/m/...` URL (or `null`) by asset id. */
  resolvePublicUrls: MediaListLookup<string | null>;
  /** Stored byte size (or `null`) by blob sha256. */
  resolveByteSizes: MediaListLookup<number | null>;
}

/** `?kind=` with the hand-written `"media"` default; anything else is a 400 before the principal is read. */
function parseMediaListKind(raw: RouteInputContext): MediaListKind {
  const kind = raw.query.kind ?? "media";
  if (kind !== "media" && kind !== "document") return rejectRoute({ status: 400, error: "invalid media kind" });
  return kind;
}

/** Documents are private uploads: neither a browser nor a shared cache may keep the list. */
const DOCUMENT_LIST_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * GET all media in the workspace (all statuses — active + trashed; mirrors `listAdminPosts`).
 * Gated by `media.read` (SPEC-021 REQ-39/OQ-01, ADR-027 §7). The document tab answers only active
 * documents and is never cached: its `Cache-Control` is set once the workspace check admitted the
 * request, so the 403 and 500 carry it and the workspace 404 does not (`admittedResponseHeaders`).
 * The kind is refused in `parse`, so a host mounting this spec defers a missing principal to
 * `authorize` to keep that 400 ahead of it, as the hand-written route did.
 */
export const mediaListRoute: JsonRouteSpec<{ kind: MediaListKind }, AdminMediaListEnvelope, MediaListRouteDeps, MediaRoutePrincipal> & {
  readonly admittedResponseHeaders: (raw: RouteInputContext) => Readonly<Record<string, string>> | undefined;
} = {
  ...defineJsonRoute<{ kind: MediaListKind }, AdminMediaListEnvelope, MediaListRouteDeps, MediaRoutePrincipal>({
    method: "get",
    path: "/api/admin/v1/workspaces/:workspaceId/media",
    parse: (raw) => ok({ value: { kind: parseMediaListKind(raw) } }),
    handle: async ({ input: { kind }, deps, authorize }) => {
      await authorizeMedia({ authorize, permission: "media.read" });
      const media = await deps.listMedia({ workspaceId: deps.workspaceId, kind });
      const visible = kind === "document" ? media.filter((row) => row.status === "active") : media;
      const [contentTypesBySha256, publicUrlsById, byteSizesBySha256] = await Promise.all([
        deps.resolveContentTypes({ media: visible }),
        deps.resolvePublicUrls({ media: visible }),
        deps.resolveByteSizes({ media: visible }),
      ]);
      return ok({ value: toAdminMediaListResponse({ media: visible, contentTypesBySha256, publicUrlsById, byteSizesBySha256 }) });
    },
  }),
  admittedResponseHeaders: (raw) => (raw.query.kind === "document" ? DOCUMENT_LIST_HEADERS : undefined),
};
