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
// belong to it. The scheme word and its value may sit on the lines after the header name (a header wrapped by a
// terminal or a mail client), as the diagnostics rules chat used before read them; the parameter list itself stays on
// the value's line. The header name may carry the proxy prefix; a name glued to a longer word or hyphenated name
// (`x-authorization`) is not the header.
const HEADER = String.raw`(?<![A-Za-z0-9_-])(?:proxy-)?authorization["']?\s*[:=]\s*["']?`;
// One `name=value` parameter: a quoted value may hold spaces, commas and escaped quotes (`realm="my realm"`),
// and an unclosed quote runs to the line end. Reading whole parameters, not whitespace-split words, is what
// keeps `response="abc def"` from ending the match at the space and leaving the rest of the response visible.
const DIGEST_PARAM = String.raw`[A-Za-z][\w-]*=(?:"(?:\\.|[^"\\\r\n])*"?|[^\s,"')]*)`;
/** Regex source of a Digest parameter list; a bare non-parameter value after `Digest` is read as one token. */
export const DIGEST_VALUE = String.raw`(?:${DIGEST_PARAM}(?:[ \t]*,[ \t]*${DIGEST_PARAM})*|[^\s,)]+(?:,[ \t]*[^\s,)]+)*)`;
const SCHEME_VALUE_RE = new RegExp(
  `${HEADER}(?:(?:Token|ApiKey)\\s+(?<single>[^\\s"'),;]+)|Digest\\s+(?<list>${DIGEST_VALUE}))`,
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
 * as HTTP clients write it in prose and logs; the credential may sit on a later line or after any run of padding (a
 * header wrapped over several lines). The leading lookahead lets the lookbehind run only where a value can start, and
 * the lookbehind's whitespace run can only succeed right after that run, so each run is read once: linear time. */
export const BARE_SCHEME_TOKEN_PATTERNS: readonly SecretRedactionPattern[] = [
  { name: 'bearer_token', regex: /(?=[A-Za-z0-9._~+/=:-])(?<=\b(?:Basic|Token)\s+)(?=[A-Za-z0-9._~+/=:-]*\d)(?!v?\d{1,4}\.\d)[A-Za-z0-9._~+/=:-]{16,}/g },
];

// Header names whose whole value is the credential. A scheme word before it belongs to the value (`x-auth-token: Token <v>`);
// a scheme word alone describes the header and stays readable.
export const API_KEY_HEADER_NAMES = 'x-api-key|api-key|x-goog-api-key|x-auth-token';
const HEADER_SCHEME_WORDS = 'Bearer|Token|ApiKey|Digest|Basic';
const SCHEME_BEARING_VALUE = `(?:Digest[ \\t]+${DIGEST_VALUE}|(?:${HEADER_SCHEME_WORDS})[ \\t]+[^\\s,;"'#}]+)`;
const SCHEME_WORD_ALONE = `(?:${HEADER_SCHEME_WORDS})(?:[\\s"'.,;:)\\]}]|$)`;

/** The header rules: groups are (prefix)(quote)(name)(separator)(value), so a collector reads the value as group 5.
 * @param required.quoted - Regex source of a quoted value, which is always masked inside its quotes. */
export function apiKeyHeaderRules({ quoted }: { readonly quoted: string }): readonly RegExp[] {
  const rule = (names: string, value: string): RegExp =>
    new RegExp(`(^|[^?&\\w])(["']?)(${names})\\2(\\s*[:=]\\s*)(${quoted}|${value})`, 'gi');
  return [
    rule(API_KEY_HEADER_NAMES, `${SCHEME_BEARING_VALUE}|(?!${SCHEME_WORD_ALONE})[^\\s,;"'#}]+`),
    // The proxy header keeps its scheme word readable like `Authorization` (the auth-scheme rules own such a value).
    rule('proxy-authorization', `(?!${HEADER_SCHEME_WORDS}(?![A-Za-z0-9_-]))[^\\s,;"'#}]+`),
  ];
}
