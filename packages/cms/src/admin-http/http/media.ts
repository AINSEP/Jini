import type { AdminMediaDto, AdminMediaListEnvelope } from "@jini-ai/core/contracts/site/cms-media";

import { documentContentType, documentDisplayFilename } from "../../media/document-ingress.js";
import type { MediaRecord } from "../../media/types.js";

/**
 * @file Admin-facing media response DTO (mirrors the members DTO and `admin-http/http/menus.ts`'s
 * pattern: serialize the internal record to a stable admin
 * JSON envelope rather than passing it through unfiltered).
 *
 * `MediaRecord` has no session/secret-shaped fields to exclude (unlike
 * members), so this mapping is a near-passthrough — kept as an explicit
 * function anyway so a future field addition to `MediaRecord` (e.g. an
 * internal-only attribution field) doesn't leak to the admin API by default.
 *
 * The wire shapes themselves (`AdminMediaDto` and its envelopes) are declared in neutral Core
 * (`@jini-ai/core/contracts/site/cms-media`, rv1123e K1) so the admin client reads the same
 * declarations; this module only serializes into them.
 */

/** The DTO's optional keys, present only when the record has a value: a description and a confirmed
 *  video codec (an unknown codec is omitted, never guessed). @complexity O(1). */
function optionalMediaFields({ media }: { media: MediaRecord }, _optional: Record<string, never> = {}): Pick<AdminMediaDto, 'description' | 'videoCodec'> {
  return {
    ...(media.description === undefined ? {} : { description: media.description }),
    ...(media.source.videoCodec ? { videoCodec: media.source.videoCodec } : {}),
  };
}

/**
 * `contentType`/`publicUrl` are REQUIRED fields rather than optional ones with a
 * `null` default: neither can be derived from `MediaRecord` alone (`contentType` is looked up
 * per-blob from `MediaContentTypeStorePort`; `publicUrl` needs a batched content-type AND
 * transform-registry lookup — see `resolveMediaPublicUrls`), and a default would let a caller that
 * simply forgot to look one up silently emit `null`, which the admin UI reads as a specific claim
 * ("this blob's bytes were unreadable" / "this asset has no public URL"). Making both explicit
 * forces each route to state what it actually knows. `byteSize` is likewise supplied by the
 * blob-store capability, never inferred from the media record or a transformed rendition.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminMediaResponse(
  { media, contentType, publicUrl, byteSize }: {
    media: MediaRecord; contentType: string | null; publicUrl: string | null; byteSize: number | null;
  },
  _optional: Record<string, never> = {},
): AdminMediaDto {
  return {
    id: media.id,
    kind: media.kind ?? "media",
    originalFilename: media.originalFilename ?? null,
    displayFilename: media.kind === "document" ? documentDisplayFilename(media) : media.title,
    createdBy: media.createdBy ?? null,
    workspaceId: media.workspaceId,
    title: media.title,
    slug: media.slug,
    alt: media.alt,
    caption: media.caption,
    credit: media.credit,
    ...optionalMediaFields({ media }),
    sha256: media.source.sha256,
    byteSize,
    status: media.status,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    version: media.version,
    width: media.width,
    height: media.height,
    cssClass: media.cssClass,
    htmlAttributes: media.htmlAttributes,
    contentType: media.kind === "document" ? documentContentType({ filename: media.originalFilename ?? "" }) : contentType,
    publicUrl: media.kind === "document" ? null : publicUrl,
  };
}

/**
 * @param contentTypesBySha256 - Recorded types keyed by blob sha256, as
 * `MediaContentTypeStorePort.getMany` returns them. A sha256 ABSENT from this map becomes a `null`
 * `contentType` on that row — the map's "absent means not sniffed yet" contract carried through to
 * the wire shape.
 * @param publicUrlsById - Keyed by `MediaRecord.id`, as `resolveMediaPublicUrls` (batch-shaped, same
 * O(1)-query contract as `contentTypesBySha256` above) returns them. An id ABSENT from this map
 * (should not happen for any id in `media`, but kept fail-soft rather than throwing) becomes a
 * `null` `publicUrl`, same as an id present with an explicit `null` value.
 * @param byteSizesBySha256 - Original blob sizes, keyed by hash; unknown or absent becomes null.
 * @complexity O(n) in `media.length` — map lookups per row are O(1).
 */
export function toAdminMediaListResponse(
  { media, contentTypesBySha256, publicUrlsById, byteSizesBySha256 }: {
    media: MediaRecord[];
    contentTypesBySha256: ReadonlyMap<string, string>;
    publicUrlsById: ReadonlyMap<string, string | null>;
    byteSizesBySha256: ReadonlyMap<string, number | null>;
  },
  _optional: Record<string, never> = {},
): AdminMediaListEnvelope {
  return {
    media: media.map((item) =>
      toAdminMediaResponse({
        media: item,
        contentType: contentTypesBySha256.get(item.source.sha256) ?? null,
        publicUrl: publicUrlsById.get(item.id) ?? null,
        byteSize: byteSizesBySha256.get(item.source.sha256) ?? null,
      })
    ),
  };
}
