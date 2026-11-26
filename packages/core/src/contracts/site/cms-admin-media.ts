/**
 * @file Admin media wire contract: the JSON shape the media REST surface serializes for one asset and
 * that every admin media/library screen reads. Lives in Core so the server route, the admin client
 * and the Jini admin screens share one declaration.
 */

import type { AdminMediaDto } from "./cms-media.js";

/**
 * One asset as the admin API answers it — the server's wire shape, declared once in Core
 * (`AdminMediaDto`, rv1123e K1); the `@jini-ai/cms` serializer answers exactly it, so the client no
 * longer restates its fields (see `AdminMediaDto` for each field's doc: `slug`, `htmlAttributes` — a
 * stored-XSS boundary the server re-validates on write and render — `contentType` — `null` means
 * unreadable bytes, kept on the All tab — and `publicUrl`).
 *
 * Client-only difference: five fields stay OPTIONAL here because legacy servers omit them —
 * `kind` (absent means ordinary media; `"document"` is a private Library document), `originalFilename`
 * (a document's immutable upload filename, `null` for media) and `displayFilename` (a document's
 * display name: the editable `title` plus the original extension), `byteSize` (original blob bytes;
 * `null` when unavailable) and the read-only `createdBy` (acting principal at creation).
 *
 * Two field notes that live only here: `width`/`height`/`cssClass` are a quick-and-dirty public-render
 * sizing override (owner-directed skip-the-ADR fix) where `null` means "not set" — the public renderer
 * omits the corresponding `<img>` attribute rather than rendering `0` or a computed default — and
 * `publicUrl` is NOT the admin's own authenticated `mediaOriginalUrl` preview URL, which is an
 * admin-only route; it is the URL the Media edit panel shows and copies.
 */
export type AdminMedia = Omit<AdminMediaDto, AdminMediaLegacyOptionalField> & Partial<Pick<AdminMediaDto, AdminMediaLegacyOptionalField>>;

/** The {@link AdminMedia} fields a legacy server may omit. */
type AdminMediaLegacyOptionalField = "kind" | "originalFilename" | "displayFilename" | "byteSize" | "createdBy";

/** One tab of the bounded media grid: every ordinary asset, images, videos, or the trash. */
export type MediaGridTab = "all" | "images" | "videos" | "trash";

/** The grid's sort: newest first (then id), or by trimmed, locale-lower-cased title (then id). */
export type MediaGridOrder = "created" | "alphabetical";

/**
 * One request to the bounded media grid route. A page request names a tab, an order, an optional
 * page size (bounded server-side to 1..100, default 50) and the opaque `nextCursor` of the previous
 * page. An exact lookup (`itemId`) is a distinct mode: it reads that one asset in the tab, takes no
 * cursor, and never scans pages to find it.
 */
export interface MediaGridRequest {
  tab: MediaGridTab;
  orderBy: MediaGridOrder;
  limit?: number;
  cursor?: string;
  itemId?: string;
}

/**
 * One bounded grid answer. `media` is the page (or the one exact-lookup asset); `nextCursor` is the
 * position after its last row, `null` on the last page and for an exact lookup. `counts` and
 * `hasUntypedActive` describe every matching row in the workspace, never just this page.
 */
export interface MediaGridPage {
  media: (AdminMedia & { trashDaysRemaining?: number })[];
  retentionDays?: number;
  nextCursor: string | null;
  counts: Record<MediaGridTab, number>;
  hasUntypedActive: boolean;
}
