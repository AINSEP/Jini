/**
 * @module redact-auth-schemes
 *
 * Values introduced by an auth scheme word other than Bearer, which the engine's Bearer rule does not
 * read. The `Authorization` header carries `Token`, `ApiKey` and `Digest` credentials too; a long
 * `Basic` or `Token` value is a credential even outside a header line. A scheme word with no value after
 * it describes a header and is never a credential. No I/O, no host state.
 */
import type { SecretRedactionPattern } from './redact.js';

/** The part of a header value that is the credential: a range of the scanned text. */
export interface ValueRange {
  readonly start: number;
  readonly end: number;
}

// A single token follows `Token` and `ApiKey`; a Digest header is a comma-separated parameter list
// (`username="bob", realm="x", response="..."`), so its value runs over the whole list and its quotes
// belong to it. `[ \t]` rather than `\s` keeps the value on its header's line. The header name may carry
// the proxy prefix; a name glued to a longer word or hyphenated name (`x-authorization`) is not the header.
const HEADER = String.raw`(?<![A-Za-z0-9_-])(?:proxy-)?authorization["']?[ \t]*[:=][ \t]*["']?`;
// One `name=value` parameter: a quoted value may hold spaces, commas and escaped quotes (`realm="my realm"`),
// and an unclosed quote runs to the line end. Reading whole parameters, not whitespace-split words, is what
// keeps `response="abc def"` from ending the match at the space and leaving the rest of the response visible.
const DIGEST_PARAM = String.raw`[A-Za-z][\w-]*=(?:"(?:\\.|[^"\\\r\n])*"?|[^\s,"')]*)`;
/** Regex source of a Digest parameter list; a bare non-parameter value after `Digest` is read as one token. */
export const DIGEST_VALUE = String.raw`(?:${DIGEST_PARAM}(?:[ \t]*,[ \t]*${DIGEST_PARAM})*|[^\s,)]+(?:,[ \t]*[^\s,)]+)*)`;
const SCHEME_VALUE_RE = new RegExp(
  `${HEADER}(?:(?:Token|ApiKey)[ \\t]+(?<single>[^\\s"'),;]+)|Digest[ \\t]+(?<list>${DIGEST_VALUE}))`,
  'gi',
);

/** Value ranges after `Token`, `ApiKey` and `Digest` in an Authorization header. O(n) in the text. */
export function authSchemeValueRanges({ text }: { readonly text: string }): ValueRange[] {
  const ranges: ValueRange[] = [];
  for (const match of text.matchAll(SCHEME_VALUE_RE)) {
    const value = match.groups?.single ?? match.groups?.list ?? '';
    const end = (match.index ?? 0) + match[0].length;
    ranges.push({ start: end - value.length, end });
  }
  return ranges;
}

/** A Basic or Token credential outside a header: 16+ characters of the token alphabet with a digit, so prose
 * ("Basic authentication is not supported", "Token expired") is untouched. The scheme word is case-sensitive
 * as HTTP clients write it in prose and logs; the credential may sit on the line after it (a header wrapped over two lines). The leading lookahead lets the lookbehind run only where a
 * value can start, so a long whitespace run is not rescanned from every position inside it. */
export const BARE_SCHEME_TOKEN_PATTERNS: readonly SecretRedactionPattern[] = [
  { name: 'bearer_token', regex: /(?=[A-Za-z0-9._~+/=:-])(?<=\b(?:Basic|Token)\s{1,16})(?=[A-Za-z0-9._~+/=:-]*\d)(?!v?\d{1,4}\.\d)[A-Za-z0-9._~+/=:-]{16,}/g },
];
