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
// Spaces or tabs may surround `=` (`response = "..."`, as some clients and hand-written examples write it); without
// them the list ended after the first name and every later parameter, the response included, was shown.
const DIGEST_PARAM = String.raw`[A-Za-z][\w-]*[ \t]*=[ \t]*(?:"(?:\\.|[^"\\\r\n])*"?|[^\s,"')]*)`;
/** Regex source of a Digest parameter list; a bare non-parameter value after `Digest` is read as one token. */
export const DIGEST_VALUE = String.raw`(?:${DIGEST_PARAM}(?:[ \t]*,[ \t]*${DIGEST_PARAM})*|[^\s,)]+(?:,[ \t]*[^\s,)]+)*)`;
// Inside the header, the token after `Bearer` is the credential whatever it says (`Bearer credentials`); outside a header
// the Bearer rule keeps such description words as prose. `<API_KEY>`-style placeholders cannot start the value.
const SCHEME_VALUE_RE = new RegExp(
  `${HEADER}(?:(?:Token|ApiKey)\\s+(?<single>[^\\s"'),;]+)|Bearer\\s+(?<bearer>[^\\s"',;<>}]+)|Digest\\s+(?<list>${DIGEST_VALUE}))`,
  'gi',
);

/** Value ranges after `Token`, `ApiKey`, `Bearer` and `Digest` in an Authorization header. O(n) in the text. */
export function authSchemeValueRanges({ text }: { readonly text: string }): ValueRange[] {
  const ranges: ValueRange[] = [];
  for (const match of text.matchAll(SCHEME_VALUE_RE)) {
    const value = match.groups?.single ?? match.groups?.bearer ?? match.groups?.list ?? '';
    const end = (match.index ?? 0) + match[0].length;
    ranges.push({ start: end - value.length, end });
  }
  return ranges;
}

/** A Basic or Token credential outside a header: 16+ characters of the token alphabet with a digit, so prose
 * ("Basic authentication is not supported", "Token expired") is untouched. The scheme word is case-sensitive
 * as HTTP clients write it in prose and logs; the credential may sit on the line after it (a header wrapped over two lines),
 * or after blank lines or any run of padding. The leading lookahead lets the lookbehind run only where a
 * value can start, so a long whitespace run is not rescanned from every position inside it: the lookbehind's whitespace
 * run can only succeed right after that run, so each run is read once. */
export const BARE_SCHEME_TOKEN_PATTERNS: readonly SecretRedactionPattern[] = [
  { name: 'bearer_token', regex: /(?=[A-Za-z0-9._~+/=:-])(?<=\b(?:Basic|Token)\s+)(?=[A-Za-z0-9._~+/=:-]*\d)(?!v?\d{1,4}\.\d)[A-Za-z0-9._~+/=:-]{16,}/g },
];

// Header names whose whole value is the credential. A scheme word before it belongs to the value (`x-auth-token: Token <v>`);
// a scheme word alone describes the header and stays readable.
export const API_KEY_HEADER_NAMES = 'x-api-key|api-key|x-goog-api-key|x-auth-token';
const HEADER_SCHEME_WORDS = 'Bearer|Token|ApiKey|Digest|Basic';
// The value may follow the scheme word on the next line, as a folded header puts it (`Basic` CRLF, indentation, value).
const SCHEME_BEARING_VALUE = `(?:Digest\\s+${DIGEST_VALUE}|(?:${HEADER_SCHEME_WORDS})\\s+[^\\s,;"'#}]+)`;
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

// Only an auth header's value starts with a scheme word. After any other label (`password=Bearer`) the word is the
// credential itself and is masked, as the rules chat used before masked it. Regex source of a lookbehind for the label.
export const AUTH_HEADER_LABEL_BEFORE = `(?<=(?:authorization|api-key|x-api-key|x-goog-api-key)["']?\\s*[:=]\\s*)`;

// `cookie=` is a cookie header written as an assignment: each `; name=value` pair after the first is part of its value.
export const COOKIE_ASSIGNMENT_RE = /\b(?:set-)?cookie\s*=\s*([^\s;"']+(?:;[ \t]*[^\s;="']+=[^\s;"']*)*)/gi;
