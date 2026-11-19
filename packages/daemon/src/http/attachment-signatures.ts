import type { StoredAttachment } from './attachment-types.js';

/**
 * `true` when `body`'s bytes 4-7 spell `ftyp` — the ISO-BMFF box tag AVIF, HEIC, and MP4 all
 * share. This says only "some member of the ISO-BMFF family", never "MP4" or "AVIF" on its own:
 * mirrors the CMS package's `content-type-sniffer.ts` `isIsoBmffFtyp`, which documents the same
 * fact for the media route's own sniffer. `detectAttachmentKind` never returns `'image'` for this
 * tag alone (see that function's doc) — doing so is exactly the 2026-09-06 regression that made an
 * AVIF render as an unplayable `<video>` when the *media* sniffer briefly had the same bug.
 */
function hasIsoBmffFtypTag(body: Uint8Array): boolean {
  return body.length >= 8 && new TextDecoder().decode(body.slice(4, 8)) === 'ftyp';
}

/** ISO-BMFF brands that identify AVIF: a still image (`avif`) or an image sequence (`avis`). Kept
 * identical to `content-type-sniffer.ts`'s `AVIF_BRANDS` so the two sniffers can never disagree on
 * which brands mean AVIF. */
const AVIF_FTYP_BRANDS = ['avif', 'avis'] as const;
const FTYP_MAJOR_BRAND_OFFSET = 8;
/** Compatible brands follow the major brand (offset 8) and 4-byte minor version (offset 12). */
const FTYP_COMPATIBLE_BRANDS_OFFSET = 16;
/** Bound on the compatible-brand list scan — real `ftyp` boxes carry a handful, never dozens. */
const MAX_SCANNED_COMPATIBLE_BRANDS = 16;

function hasAvifBrandAt(body: Uint8Array, offset: number): boolean {
  return body.length >= offset + 4
    && AVIF_FTYP_BRANDS.some((brand) => new TextDecoder().decode(body.slice(offset, offset + 4)) === brand);
}

/** The `ftyp` box's declared end offset (big-endian size at bytes 0-3), clamped to the bytes
 * actually present so a truncated or size-inflating file can never push the brand scan past the
 * captured signature window.
 *
 * Exported so its short-body bounds guard can be exercised directly: {@link hasAvifSignature}, its
 * only caller, already requires 8 bytes before calling it, so no call through that path can reach
 * the guard — but the guard is what keeps this function safe on its own and stays. */
export function ftypBoxEnd({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): number {
  if (body.length < FTYP_MAJOR_BRAND_OFFSET) return 0;
  const declared = ((body[0]! << 24) | (body[1]! << 16) | (body[2]! << 8) | body[3]!) >>> 0;
  return Math.min(declared, body.length);
}

/**
 * `true` when `body` opens with an ISO-BMFF `ftyp` box whose major brand or compatible-brand list
 * names AVIF. This is a line-for-line mirror of the CMS package's `content-type-sniffer.ts`
 * `isAvif` (no shared dependency exists between HTTP kit and the CMS package today — see
 * this module's handoff notes on whether extracting one is worth it): the major brand alone is not
 * sufficient, because a great many real AVIF files declare the generic `mif1` (HEIF image) major
 * brand and name `avif` only in the compatible-brand list, so both are checked. HEIC declares
 * neither and is therefore never matched here — deliberate; nothing downstream of this attachment
 * store has confirmed it can render a HEIC as an `<img>`, so labelling one `'image'` would risk the
 * same "sniffed as a type the surface cannot actually display" failure this whole fix addresses.
 *
 * Must run before any generic `ftyp` check: {@link hasIsoBmffFtypTag} alone cannot tell AVIF, HEIC,
 * and MP4 apart, so a brand-blind caller would misclassify every ISO-BMFF file it sees as one type.
 */
export function hasAvifSignature({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  if (!hasIsoBmffFtypTag(body)) return false;
  if (hasAvifBrandAt(body, FTYP_MAJOR_BRAND_OFFSET)) return true;

  const boxEnd = ftypBoxEnd({ body });
  for (let index = 0; index < MAX_SCANNED_COMPATIBLE_BRANDS; index++) {
    const offset = FTYP_COMPATIBLE_BRANDS_OFFSET + index * 4;
    if (offset + 4 > boxEnd) return false;
    if (hasAvifBrandAt(body, offset)) return true;
  }
  return false;
}

/**
 * Bytes of leading signature `detectAttachmentKind` needs. WEBP's marker ends at byte 12; AVIF
 * needs more — {@link hasAvifSignature}'s compatible-brand scan can read as far as
 * `FTYP_COMPATIBLE_BRANDS_OFFSET + MAX_SCANNED_COMPATIBLE_BRANDS * 4` (a great many real AVIF
 * files declare the generic `mif1` major brand and name `avif` only in the compatible-brand list —
 * see that function's doc), so this is sized to that worst case rather than to the smallest format.
 */
export const SIGNATURE_BYTES = FTYP_COMPATIBLE_BRANDS_OFFSET + MAX_SCANNED_COMPATIBLE_BRANDS * 4;

/** The complete PNG signature includes the CR/LF and control-byte corruption markers. */
const PNG_SIGNATURE_PREFIX: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `true` when `body`'s first 8 bytes are the PNG signature. */
export function hasPngSignature({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  return body.length >= 8 && PNG_SIGNATURE_PREFIX.every((byte, index) => body[index] === byte);
}

/** `true` when `body`'s first 3 bytes are the JPEG start-of-image marker. */
export function hasJpegSignature({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  return body.length >= 3
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff;
}

/** `true` when `body`'s first 6 bytes spell either GIF version tag. */
export function hasGifSignature({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  const signature = new TextDecoder().decode(body.slice(0, 6));
  return signature === 'GIF87a' || signature === 'GIF89a';
}

/** `true` when `body` opens with a RIFF container whose form type is WEBP. */
export function hasWebpSignature({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  return body.length >= 12
    && new TextDecoder().decode(body.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(body.slice(8, 12)) === 'WEBP';
}

/** Every recognized image signature, checked in this order until one matches. */
const IMAGE_SIGNATURE_MATCHERS: readonly ((args: { body: Uint8Array }) => boolean)[] = [
  hasPngSignature,
  hasJpegSignature,
  hasGifSignature,
  hasWebpSignature,
  hasAvifSignature,
];

/**
 * Infers `'image'` from the leading bytes rather than from a renderer-controlled MIME type or file
 * extension. PNG, JPEG, GIF87a/89a, WEBP, and AVIF (brand-checked ISO-BMFF, see
 * {@link hasAvifSignature}) are recognized; everything else is `'file'` — including a plain MP4 or
 * other non-AVIF ISO-BMFF file, which shares AVIF's `ftyp` tag but is deliberately NOT matched here
 * (see {@link hasIsoBmffFtypTag}'s doc for why a brand-blind `ftyp` check would be wrong).
 *
 * `kind` decides whether a path is later passed to `AgentExecutor.run()`'s `imagePaths`, so letting
 * a renderer assert it would let a renderer choose how the agent runtime parses the bytes.
 */
export function detectAttachmentKind({ body }: { readonly body: Uint8Array }, _optional: Record<string, never> = {}): StoredAttachment['kind'] {
  return IMAGE_SIGNATURE_MATCHERS.some((matchesSignature) => matchesSignature({ body })) ? 'image' : 'file';
}
