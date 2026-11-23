/**
 * @file The admin `media` wire DTOs (ADR-029): the JSON bodies the media admin routes answer with and
 * an admin client reads. Declared here, once, so the server serializer
 * (`@jini-ai/cms/admin-http/http/media`) and any client mirror read the same shapes without the client
 * depending on CMS. Serialization rules (document display names, sniffed content types, public URLs)
 * stay in CMS; only the declarations sit in Core.
 *
 * Core cannot import CMS, so the media record's `status` and `kind` unions are restated structurally
 * here. CMS's `admin-http/http/__tests__/media.test.ts` pins them against `MediaStatus` and
 * `MediaKind` in both directions; keep the two sides identical.
 */

/** Deletion-ladder status of an asset (CMS `MediaStatus`). */
export type AdminMediaStatus = 'active' | 'trashed';

/** `"document"` for a private Library document, `"media"` for ordinary media (CMS `MediaKind`). */
export type AdminMediaKind = 'media' | 'document';

/** One asset as the admin API answers it. */
export interface AdminMediaDto {
  id: string;
  kind: AdminMediaKind;
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
  status: AdminMediaStatus;
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

/** The single-asset body (update, trash). */
export interface AdminMediaEnvelope { media: AdminMediaDto }

/** The list body. */
export interface AdminMediaListEnvelope { media: AdminMediaDto[] }

/** The hard-purge body: `purged` is always `true` (a refused purge answers a 4xx instead). */
export interface AdminMediaPurgeEnvelope { purged: true }

/**
 * The media-generation vendor credentials, keyed by provider id, as markers only (that a key exists,
 * its last characters) — never key material. A bare map, not a `{ data }` envelope: `{}` means
 * "reached, manages nothing".
 */
export type AdminMediaProviderMarkers = Record<string, unknown>;
