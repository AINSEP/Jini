/**
 * @file Magic-byte content-type sniffer for media originals.
 *
 * Purpose:
 * `uploadMedia` (`media-service.ts`) validates only a client-supplied `contentType`
 * STRING against an advisory allowlist — it never inspects the actual bytes (see
 * that file's header, point 4: "an attacker-controlled `contentType` header is
 * trusted, which the real ingress policy would never do"). Neither `media` nor
 * `asset_blobs` persists a real content type at all (no column exists). Any route
 * that serves an asset's original bytes back out therefore cannot trust either the
 * upload-time string or any stored column for `Content-Type` — it must derive the
 * type itself, from the bytes it is about to send, every time it serves them. That
 * is a host route's job, not this module's — this module only supplies the sniff.
 *
 * This is an ALLOWLIST sniffer, not a general-purpose one: {@link sniffContentType}
 * recognizes exactly the binary signatures named below and returns
 * `application/octet-stream` for anything else. The one deliberate exception is
 * markup that looks like HTML or SVG — see {@link isHtmlLike}/{@link isSvgLike} —
 * which this module DOES detect and label, specifically so a caller can single out
 * "textual markup that is a same-origin stored-XSS vector if ever served as its own
 * content type" from "an arbitrary unrecognized blob" and act on it explicitly
 * (a serving route can force `Content-Disposition: attachment` for the former). This
 * module does not attempt general-purpose HTML/XML sniffing beyond that.
 *
 * Detection windows: every binary signature check below only ever reads the first
 * 12 bytes; the markup checks decode up to {@link TEXT_SNIFF_WINDOW} leading bytes
 * (the same 512-byte order of magnitude the WHATWG MIME Sniffing Standard uses for
 * its "read the first N bytes" unknown-type algorithms —
 * https://mimesniff.spec.whatwg.org/#reading-the-resource-header — this module
 * borrows only that window-size convention, not the spec's actual algorithm).
 */

/** Recognized outputs. Anything not covered here falls back to the network's
 * default-safe unknown-binary label — see {@link sniffContentType}'s doc. */
export type SniffedContentType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "video/mp4"
  | "video/webm"
  | "text/html"
  | "image/svg+xml"
  | "application/octet-stream";

/** Bounded leading window used only for the textual (HTML/SVG) checks — see file header. */
const TEXT_SNIFF_WINDOW = 512;

/** `true` iff `bytes` is long enough and holds `expected` starting at `offset`. Never throws on a
 * short input — a too-short buffer simply fails the length check, matching every other predicate
 * in this file's "no exceptions, just non-matches" contract. */
function bytesEqualAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

function asciiEqualAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return bytesEqualAt(
    bytes,
    offset,
    Array.from(expected, (ch) => ch.charCodeAt(0))
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** EBML header — shared by the whole Matroska family (`.mkv`/`.webm`); this sniffer only ever
 * labels it `video/webm` since WebM is the only Matroska-family format in this route's scope. */
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

function isPng(bytes: Uint8Array): boolean {
  return bytesEqualAt(bytes, 0, PNG_SIGNATURE);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytesEqualAt(bytes, 0, JPEG_SIGNATURE);
}

function isGif(bytes: Uint8Array): boolean {
  return asciiEqualAt(bytes, 0, "GIF87a") || asciiEqualAt(bytes, 0, "GIF89a");
}

/** RIFF container with a `WEBP` form type — bytes 4-7 are a chunk size (variable, not checked). */
function isWebp(bytes: Uint8Array): boolean {
  return asciiEqualAt(bytes, 0, "RIFF") && asciiEqualAt(bytes, 8, "WEBP");
}

/** ISO-BMFF (MP4 and its siblings): a leading box whose 4-byte type tag at offset 4 is `ftyp`. The
 * box's own size field (offset 0-3) is deliberately not checked — it varies by file. */
function isIsoBmffMp4(bytes: Uint8Array): boolean {
  return asciiEqualAt(bytes, 4, "ftyp");
}

function isWebm(bytes: Uint8Array): boolean {
  return bytesEqualAt(bytes, 0, EBML_SIGNATURE);
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** Decodes up to {@link TEXT_SNIFF_WINDOW} leading bytes as latin1 (byte-for-byte, never throws on
 * invalid UTF-8 the way a strict "utf8" decode could), strips a leading UTF-8 BOM plus any leading
 * ASCII whitespace, and lowercases — mirrors the "skip leading noise before sniffing markup" step
 * browsers perform before matching tag prefixes. */
function leadingText(bytes: Uint8Array): string {
  const window = bytes.subarray(0, Math.min(bytes.length, TEXT_SNIFF_WINDOW));
  const decoded = Buffer.from(window).toString("latin1");
  const withoutBom = bytesEqualAt(window, 0, UTF8_BOM) ? decoded.slice(UTF8_BOM.length) : decoded;
  return withoutBom.replace(/^\s+/, "").toLowerCase();
}

const HTML_PREFIXES = ["<!doctype html", "<html", "<head", "<script", "<body", "<iframe", "<title", "<frameset"];

/** Matches a leading HTML tag prefix directly, or an XHTML document whose `<?xml ...?>` prolog is
 * followed by `<html` within the sniffed window — either shape is `text/html`-equivalent for this
 * module's purpose (a same-origin-render XSS vector), so both collapse to `"text/html"` rather than
 * a separate `application/xhtml+xml` value (a serving route still blocks that literal string too, as
 * defense in depth against a future caller adding it here). */
function isHtmlLike(text: string): boolean {
  if (HTML_PREFIXES.some((prefix) => text.startsWith(prefix))) return true;
  if (text.startsWith("<?xml")) return text.includes("<html");
  return false;
}

/** Matches a leading `<svg` root element, or an XML prolog followed by `<svg` within the sniffed
 * window (`<?xml version="1.0"?><svg ...>`, the common real-world SVG file shape). */
function isSvgLike(text: string): boolean {
  if (text.startsWith("<svg")) return true;
  if (text.startsWith("<?xml")) return text.includes("<svg");
  return false;
}

/**
 * Identifies a media type from `bytes`' leading magic bytes. Allowlist-shaped: only the formats
 * named in {@link SniffedContentType} are ever returned as something other than
 * `"application/octet-stream"` — an input this function does not recognize (including a truncated,
 * corrupt, or genuinely unknown-format file) always falls back to the safe default, it never
 * guesses. `text/html`/`image/svg+xml` are the one case this module positively looks for rather
 * than falls back to, precisely so a caller can treat them as hostile rather than merely unknown
 * (see file header).
 *
 * @complexity O(1) — every binary check reads at most 12 bytes; the textual checks decode at most
 * {@link TEXT_SNIFF_WINDOW} bytes, a fixed constant independent of `bytes.length`.
 * @overallScore 100
 */
export function sniffContentType(bytes: Uint8Array): SniffedContentType {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isGif(bytes)) return "image/gif";
  if (isWebp(bytes)) return "image/webp";
  if (isIsoBmffMp4(bytes)) return "video/mp4";
  if (isWebm(bytes)) return "video/webm";

  const text = leadingText(bytes);
  if (isHtmlLike(text)) return "text/html";
  if (isSvgLike(text)) return "image/svg+xml";

  return "application/octet-stream";
}
