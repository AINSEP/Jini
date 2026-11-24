import { CustomCredentialValidationError } from "../credentialed-http/sets/store.js";

/**
 * @file The one place a token typed or pasted into a credential card is cleaned before the store
 * validates it. Copying a key from a provider's dashboard often brings a trailing newline or space,
 * and from some web pages an invisible zero-width character that `String.prototype.trim` keeps
 * (2026-10-22: a pasted key was refused with the raw "visible ASCII (0x21–0x7E)" rule). Edge junk is
 * dropped; the interior is never rewritten, so a real stray character still refuses, in words a
 * person can act on.
 */

/** Whitespace plus the zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM) `trim` keeps. */
const EDGE_JUNK = /^[\s​-‍⁠﻿]$/u;

/** Shown instead of the store's byte-range rule when a cleaned token still has a non-visible-ASCII character. */
export const TOKEN_PASTE_AGAIN_MESSAGE = "The token has a space, line break or special character in it — paste it again.";

/**
 * Strips leading and trailing whitespace and zero-width characters from a card-submitted token.
 *
 * @param required - The raw submitted token.
 * @returns The token without edge junk; an all-junk token returns "" for the store's blank rule.
 * @throws CustomCredentialValidationError with {@link TOKEN_PASTE_AGAIN_MESSAGE} when an interior
 *   character is outside visible ASCII. The message never quotes the token.
 * @complexity O(n) in the token length.
 */
export function cleanCardToken({ token }: { token: string }, _optional = {}): string {
  let start = 0;
  let end = token.length;
  while (start < end && EDGE_JUNK.test(token[start]!)) start++;
  while (end > start && EDGE_JUNK.test(token[end - 1]!)) end--;
  const cleaned = token.slice(start, end);
  if (/[^\x21-\x7e]/.test(cleaned)) throw new CustomCredentialValidationError(TOKEN_PASTE_AGAIN_MESSAGE);
  return cleaned;
}
