import { escapeHtml } from "@jini-ai/core/text";

/**
 * @file Optional WebVTT captions for a public `<video>`/`<audio>` player (owner decision G7-9:
 * "optional caption file on media, rendered when present").
 *
 * The host resolves a media record's stored {@link MediaCaptionsTrack} reference (a sibling `.vtt`
 * asset id, see `media/types.ts`) to that asset's public `/m/.../original.vtt` URL and hands the
 * result here as a {@link CaptionTrackInput}. This module never trusts that URL: a caption source
 * that is not a same-origin `/m/` WebVTT path, or a malformed `srclang`, is refused and the player
 * renders exactly as it would with no captions at all (fail closed, never a partial tag).
 */

/** A resolved caption track, ready to render. `label` is the human menu name; absent/empty omits it. */
export interface CaptionTrackInput {
  readonly src: string;
  readonly srclang: string;
  readonly label?: string | null | undefined;
}

// The `/m/{key}/...` public media URL contract (ADR-027 §4, `media/site/public-path.ts`). Requiring
// it — not just "root-relative" — keeps a caption source on the site's own media route: no scheme
// (`javascript:`/`data:`), no protocol-relative `//host`, no backslash host tricks, no whitespace.
const MEDIA_ROUTE_PREFIX = "/m/";
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point.
const UNSAFE_URL_CHARS = /[\s\\\u0000-\u001f\u007f]/;
// BCP 47-shaped: a 2-3 letter primary language subtag plus optional short subtags (`en`, `pt-BR`).
const SRCLANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * True only for a same-origin `/m/...` URL whose path (before any `?`/`#`) ends in `.vtt` and has no
 * empty or dot-dot/dot segments.
 *
 * @complexity O(n) in the URL length.
 */
export function isSafeCaptionTrackSrc({ src }: { src: string }, _optional: Record<string, never> = {}): boolean {
  if (!src.startsWith(MEDIA_ROUTE_PREFIX) || UNSAFE_URL_CHARS.test(src)) return false;
  const path = src.split(/[?#]/, 1)[0]!;
  const segments = path.slice(MEDIA_ROUTE_PREFIX.length).split("/");
  // An empty segment (`/m//host/...`) or a `.`/`..` segment could re-target the path off the media route.
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return path.toLowerCase().endsWith(".vtt");
}

/**
 * Renders `<track kind="captions" ... default>` for a safe track, or `""` when the track is absent or
 * refused — so a caller can always splice the result in and an uncaptioned player stays byte-identical.
 *
 * @complexity O(n) in the URL + label length.
 */
export function renderCaptionTrack({ track }: { track: CaptionTrackInput | null | undefined }, _optional: Record<string, never> = {}): string {
  if (!track || !isSafeCaptionTrackSrc({ src: track.src }) || !SRCLANG_PATTERN.test(track.srclang)) return "";
  const label = track.label ? ` label="${escapeHtml({ text: track.label })}"` : "";
  return `<track kind="captions" src="${escapeHtml({ text: track.src })}" srclang="${track.srclang}"${label} default>`;
}
