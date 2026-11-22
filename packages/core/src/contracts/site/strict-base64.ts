/**
 * @file Strict standard-base64 (RFC 4648 §4, padded) decoder for any inbound `dataBase64` field.
 *
 * `Buffer.from(x, "base64")` never throws — it silently skips characters outside the base64
 * alphabet instead of refusing them, so a malformed string such as `"Zm9v$"` or a truncated one
 * such as `"Zm9"` decodes to *something* rather than raising. Two upload routes
 * (`routes/publish-content/blob-put.ts` and `routes/media/upload.ts`) wrapped that call in a
 * try/catch that can never fire, which let corrupted payloads through as if they were valid.
 *
 * Adopts the same rule as Jini's module-private `Jini packages/daemon/src/http/connectors.ts` `isWellFormedBase64`:
 * non-empty, a length that is a multiple of 4, and every character drawn from the standard
 * (non-URL) alphabet plus up to two trailing `=` pad characters. A round-trip canonical check
 * (decode, re-encode, compare) was considered and rejected: it costs an extra ~67 MB string at the
 * 50 MiB upload cap and rejects nothing that matters here — non-canonical pad
 * bits (`"Zm9="`
 * decoding to the same bytes as canonical `"Zm8="`) are not a security concern for these routes.
 */

const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decodes `value` as standard, padded base64, or returns `null` for anything that is not
 * well-formed standard base64 (wrong alphabet, base64url `-`/`_`, unpadded/truncated length, or
 * an empty string).
 *
 * @param required.value - The candidate base64 string, exactly as received from a request body.
 * @returns The decoded bytes, or `null` if `value` is not well-formed standard base64.
 * @complexity O(n) in `value`'s length — one regex pass plus one `Buffer.from` decode.
 */
export function decodeStrictBase64({ value }: { value: string }, _optional = {}): Uint8Array | null {
  if (!value || value.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(value)) return null;
  return new Uint8Array(Buffer.from(value, "base64"));
}
