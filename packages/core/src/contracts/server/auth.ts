/**
 * @file Bearer-token header grammar shared by every bearer gate, so the accepted `Authorization`
 * header is defined exactly once.
 */

const BEARER_TOKEN_PATTERN = /^Bearer\s+(\S+)\s*$/i;

/**
 * Extracts the token from an `Authorization: Bearer <token>` header value. The scheme is
 * case-insensitive per RFC 7235 §2.1; the token itself is not.
 *
 * Shared by every bearer gate so the accepted header grammar is defined exactly
 * once — three separate copies of this regex is three chances for them to disagree about what
 * counts as a well-formed header.
 *
 * @param header - The raw `Authorization` header value, or `undefined` when absent.
 * @returns The token, or `null` when the header is absent or not a well-formed bearer header.
 * @complexity O(n) in the header length.
 */
export function bearerTokenFromHeader({ header }: { readonly header: string | undefined }, _optional: Record<string, never> = {}): string | null {
  return BEARER_TOKEN_PATTERN.exec(header ?? '')?.[1] ?? null;
}
