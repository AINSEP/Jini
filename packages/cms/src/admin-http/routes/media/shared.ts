import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { AdminMediaDto } from "@jini-ai/core/contracts/site/cms-media";

import { EntityNotLiveError } from "../../../core/entity-liveness.js";
import { MediaConflictError, MediaNotFoundError, MediaValidationError, type MediaRecord } from "../../../media/types.js";
import { toAdminMediaResponse } from "../../http/media.js";

/**
 * @file Shared guards, error mapping and the single-asset response for the `media` admin route specs.
 *
 * Every media route opened with the same workspace check, and the write/read routes each carried an
 * identical 403 block and their own `instanceof` ladder. The workspace check and the 403 are the
 * host's ports now; each route keeps its exact ladder as a small mapping table here, so the bodies
 * the admin client reads stay byte-identical.
 */

/** The principal fields these routes read: only the id, as the actor of a trash move. */
export interface MediaRoutePrincipal { id: string }

/** One `catch` rung: which thrown error maps to which status, with which code and copy. */
export interface MediaErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  /** A fixed code, or `"own"` for the error's own `code` field (the trashed/tombstoned pair). */
  readonly code?: string | "own";
  /** Fixed caller copy instead of the error's own message (a host-worded refusal whose cause stays private). */
  readonly error?: string;
}

/** A trashed or tombstoned asset: 409 with the liveness error's own code (`entityNotLiveResponse`'s rule). */
export const MEDIA_NOT_LIVE: MediaErrorMapping = { matches: ({ err }, _o = {}) => err instanceof EntityNotLiveError, status: 409, code: "own" };
export const MEDIA_NOT_FOUND: MediaErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MediaNotFoundError, status: 404 };
export const MEDIA_VALIDATION: MediaErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MediaValidationError, status: 400 };
// A slug collision — either `resolveSlugForUpdate`'s own app-level courtesy check, or (on a
// genuine race) `SqliteMediaRepo.save()`'s translated UNIQUE-constraint catch; both throw the
// same `MediaConflictError` so this route needs only one branch regardless of which layer
// caught it. 409, not 400: the request is well-formed, it just collides with existing state.
export const MEDIA_CONFLICT: MediaErrorMapping = { matches: ({ err }, _o = {}) => err instanceof MediaConflictError, status: 409 };

/**
 * Refuses with the first matching rung's status, code and copy; anything unmapped is rethrown
 * unchanged so the host's error port answers it as an unexpected (redacted) failure.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectMediaError({ err, mappings }: { err: unknown; mappings: readonly MediaErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  const error = mapping.error ?? (err instanceof Error ? err.message : String(err));
  const code = mapping.code === "own" ? (err as { code?: string }).code : mapping.code;
  return rejectRoute(code === undefined ? { status: mapping.status, error } : { status: mapping.status, error, code });
}

/**
 * Asks the host for one media permission on the `media` entity type. By-id routes pass the asset's
 * `entityId`; the provider routes act on no single asset. A mount without an authorizer is a wiring
 * bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMedia(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("media admin route has no authorizer");
  const required = { permission, entityType: "media" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal's id, recorded as the actor of a trash move. @complexity O(1). */
export function mediaActorId({ context }: { context: MediaRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("media admin route has no authenticated principal");
  return context.id;
}

/** The `:mediaId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function mediaIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.mediaId ?? "");
}

/** The single-asset lookups behind the three DTO fields a `MediaRecord` cannot answer itself. They are
 *  host services (its recorded-type store, its public-URL/transform registry, its blob-size capability). */
export interface MediaAssetLookups {
  /** The recorded (sniffed) content type for a blob hash; `null` when not sniffed yet. */
  readContentType: (required: { sha256: string }) => Promise<string | null>;
  /** The asset's public `/m/...` URL; `null` when it has none (trashed, no public transform). */
  resolvePublicUrl: (required: { media: MediaRecord }) => Promise<string | null>;
  /** The original blob's stored size; `null` when the store cannot tell. */
  resolveByteSize: (required: { media: MediaRecord }) => Promise<number | null>;
}

/** The admin response for one asset: recorded type, public URL and stored size, read in parallel.
 *  @complexity O(1) — three independent single-asset lookups. */
export async function describeMediaAsset(
  { deps, media }: { deps: MediaAssetLookups; media: MediaRecord },
  _optional: Record<string, never> = {},
): Promise<AdminMediaDto> {
  const [contentType, publicUrl, byteSize] = await Promise.all([
    deps.readContentType({ sha256: media.source.sha256 }),
    deps.resolvePublicUrl({ media }),
    deps.resolveByteSize({ media }),
  ]);
  return toAdminMediaResponse({ media, contentType, publicUrl, byteSize });
}
