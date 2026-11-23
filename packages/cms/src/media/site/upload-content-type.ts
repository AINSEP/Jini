import { DEFAULT_ALLOWED_MIME_TYPES, MediaValidationError, sniffContentType } from "../index.js";

/**
 * @file Decides an uploaded file's content type from its bytes, not the client's declaration.
 *
 * `uploadMedia` checks only the client-declared `contentType` string against
 * `DEFAULT_ALLOWED_MIME_TYPES`, so unsanitized markup declared as `image/png` used to be stored. This sniffs
 * the magic bytes and requires the result to be on that same allowlist — the one server-side source
 * of truth the admin picker, post editor and URL importer lists mirror.
 */

/**
 * Sniffs `bytes` and returns the resulting content type when it is on `DEFAULT_ALLOWED_MIME_TYPES`.
 * The one place that owns this rejection, so every caller that needs "are these bytes an allowed
 * media type" (the declared-type check below, and the agent upload path in `tool-registrations.ts`)
 * throws the identical message instead of each re-deriving it.
 *
 * @throws MediaValidationError `the file's content (<sniffed>) is not an allowed media type`.
 * @complexity O(1) — the sniffer reads a fixed-size prefix.
 */
export function assertAllowedSniffedContentType({ bytes }: { bytes: Uint8Array }, _optional: Record<string, never> = {}): string {
  const sniffed = sniffContentType({ bytes });
  if (!DEFAULT_ALLOWED_MIME_TYPES.has(sniffed)) {
    throw new MediaValidationError({ message: `the file's content (${sniffed}) is not an allowed media type` });
  }
  return sniffed;
}

/**
 * The content type to store for an upload: the sniffed type when it is an allowed media type.
 *
 * - Declared type not allowed → returned unchanged, so `uploadMedia` rejects it with its own message.
 * - Bytes sniff to anything outside the allowlist (HTML, unrecognized) → rejected.
 * - Bytes are a different ALLOWED type than declared (a PNG named `.jpg`) → the sniffed type, so the
 *   record says what the file really is instead of refusing an ordinary mislabeled image.
 *
 * @throws MediaValidationError `the file's content (<sniffed>) is not an allowed media type`.
 * @complexity O(1) — the sniffer reads a fixed-size prefix.
 */
export function resolveUploadContentType(input: { bytes: Uint8Array; declaredContentType: string }): string {
  if (!DEFAULT_ALLOWED_MIME_TYPES.has(input.declaredContentType)) return input.declaredContentType;
  return assertAllowedSniffedContentType({ bytes: input.bytes });
}
