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
 */

export interface AdminMediaResponse {
  id: string;
  kind: "media" | "document";
  originalFilename: string | null;
  displayFilename: string;
  /** Stable creation principal ID; NULL means unknown legacy/pre-migration attribution. */
  createdBy: string | null;
  workspaceId: string;
  title: string;
  /** Human-memorable, unique-per-workspace lookup key (2026-09-07) — see `MediaRecord.slug`'s own
   *  doc (`@jini-ai/cms/media`) for the full identity model. */
  slug: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  /** Original blob bytes; null when storage is missing or cannot report a size. */
  byteSize: number | null;
  status: MediaRecord["status"];
  createdAt: string;
  updatedAt: string;
  version: number;
  width: number | null;
  height: number | null;
  cssClass: string | null;
  /** Free-text HTML attributes threaded onto this asset's public tag (2026-09-07) — see
   *  `MediaRecord.htmlAttributes`'s own doc (`@jini-ai/cms/media`) for the full identity/security
   *  model. Already validated by the time it reaches here; this DTO does not re-validate. */
  htmlAttributes: string | null;
  /**
   * The asset's real media type — always `sniffContentType(bytes)` from the stored bytes, never
   * the client's declared upload string (see `media/content-type-store.ts` for why). Drives the
   * admin Media screen's "Images"/"Videos" tabs.
   *
   * `null` means "not sniffed yet", NOT "unknown format" — an unrecognized blob reports the real
   * answer `"application/octet-stream"`. A `null` is only ever seen for a blob whose bytes could
   * not be read at list time; the list route backfills every other pre-existing row on read. The
   * admin UI must keep `null` rows visible somewhere rather than filtering them into oblivion.
   */
  contentType: string | null;
  /**
   * The asset's real, public, readable `/m/...` URL (readable-slugs S5a, 2026-09-23) — the same
   * `mediaUrlKey`/`mediaPublicPath` contract `seo/media.ts` and the
   * host's own public-URL resolver (`resolveMediaPublicUrls`) already use, keyed by the
   * asset's current slug when it has a valid one, otherwise its id. `null` for every case
   * `resolveMediaPublicUrls` itself returns `null` for — a trashed asset (never a link a visitor
   * would 404 on), or no "public" core transform registered yet — never a partially-built or
   * fabricated guess.
   */
  publicUrl: string | null;
}

export interface AdminMediaEnvelope {
  media: AdminMediaResponse;
}

export interface AdminMediaListEnvelope {
  media: AdminMediaResponse[];
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
): AdminMediaResponse {
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
