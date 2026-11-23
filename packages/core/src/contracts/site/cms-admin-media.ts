/**
 * @file Admin media wire contract: the JSON shape the media REST surface serializes for one asset and
 * that every admin media/library screen reads. Lives in Core so the server route, the admin client
 * and the Jini admin screens share one declaration.
 */

export interface AdminMedia {
  id: string;
  /** `"document"` for a private Library document, `"media"` for ordinary media. Legacy servers omit it. */
  kind?: "media" | "document";
  /** A document's immutable upload filename (its extension never changes); `null` for media. */
  originalFilename?: string | null;
  /** A document's display name: the editable `title` plus the original extension. */
  displayFilename?: string;
  /** Original blob bytes; null when unavailable. Legacy servers omit the field. */
  byteSize?: number | null;
  /** Read-only acting principal at creation; absent/null on legacy servers or assets. */
  createdBy?: string | null;
  workspaceId: string;
  title: string;
  /** Human-memorable, unique-per-workspace lookup key (2026-09-07) — auto-derived from `title` at
   *  upload, then independently editable here. Renaming `title` never changes this field; see
   *  the edit-media panel's slug field for the operator-facing edit surface. */
  slug: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Quick-and-dirty public-render sizing override (owner-directed skip-the-ADR fix). `null` means
   *  "not set" — the public renderer omits the corresponding `<img>` attribute entirely rather than
   *  rendering `0` or a computed default. */
  width: number | null;
  height: number | null;
  cssClass: string | null;
  /**
   * Free-text HTML attributes (2026-09-07, owner-directed) threaded onto this asset's public
   * `<img>`/`<video>` tag — same "one string column, `null` means not set" shape as `cssClass`.
   * Raw, ALREADY-VALIDATED source text (e.g. `data-motion="fade-in" loading="lazy"`). This is a
   * stored-XSS boundary: the server re-validates against the same allowlist
   * (the media rules module's `parseMediaHtmlAttributes`) on both write and render, so a
   * client-side check here is a UX convenience, never the enforcement itself.
   */
  htmlAttributes: string | null;
  /**
   * The asset's real media type, sniffed server-side from the stored bytes — never the content
   * type the browser reported at upload time. Drives the Media screen's "Images"/"Videos" tabs.
   *
   * `null` means "the server could not read this blob's bytes", NOT "unknown format": an
   * unrecognized file reports the real answer `"application/octet-stream"`. A `null` row is
   * therefore a genuine anomaly, and `filterMediaByTab` keeps it on the All tab rather than
   * dropping it from the screen.
   */
  contentType: string | null;
  /**
   * The asset's real, public `/m/...` URL (readable-slugs S5a, 2026-09-23) — keyed by its readable
   * slug when it has a valid one, otherwise its id. `null` for a trashed asset (never a link a
   * visitor would 404 on) or when no "public" core transform is registered yet. This is the URL
   * the Media edit panel shows/copies; it is NOT the same as the admin's own `mediaOriginalUrl`
   * preview URL below, which is an authenticated admin-only route.
   */
  publicUrl: string | null;
}
