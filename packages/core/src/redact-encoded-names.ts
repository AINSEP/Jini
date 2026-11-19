/**
 * @module redact-encoded-names
 *
 * Field names written with escapes: a percent escape in a URL or form parameter name (`%74oken=`) or a `\u` escape in a
 * quoted JSON key (`"password":`). The name is decoded first and then judged by the URL parameter vocabulary, so an
 * escape cannot hide a credential name from rules that read the raw spelling. No I/O, no host state.
 */
import type { ValueRange } from './redact-auth-schemes.js';
import { URL_SECRET_PARAM_RE } from './redact-url-params.js';

// Only names holding an escape are read here; plain names already have their own rules. Each name part is bounded, so a
// start costs O(1) and the scan stays linear.
const ESCAPED_PARAM_RE = /(?<![^?&#;\s])([\w.~-]{0,64}%[0-9A-Fa-f]{2}[\w.~%-]{0,64})=([^&;#\s"'<>()]+)/g;
const ESCAPED_KEY_RE = /(["'])((?:[^"'\\\r\n]|\\.){0,64}?\\u[0-9A-Fa-f]{4}(?:[^"'\\\r\n]|\\.){0,64}?)\1[ \t]*:[ \t]*(?:(["'])((?:\\.|(?!\3)[^\\\r\n])*)\3|([^\s"',}\]]+))/g;
const PERCENT_ESCAPE = /%([0-9A-Fa-f]{2})/g;
const UNICODE_ESCAPE = /\\u([0-9A-Fa-f]{4})/g;
const decodeEscape = (_escape: string, hex: string): string => String.fromCharCode(parseInt(hex, 16));
const URL_NAME = new RegExp(URL_SECRET_PARAM_RE.source, 'iy');

/** True when `name`, already decoded, is a credential parameter name. */
function isCredentialName({ name }: { readonly name: string }, _optional = {}): boolean {
  const probe = `?${name}=x`;
  URL_NAME.lastIndex = 0;
  return URL_NAME.exec(probe)?.[0].length === probe.length;
}

/** Value ranges of parameters whose percent-decoded name is a credential name. */
function escapedParamRanges({ text }: { readonly text: string }, _optional = {}): ValueRange[] {
  return [...text.matchAll(ESCAPED_PARAM_RE)]
    .filter(match => isCredentialName({ name: (match[1] ?? '').replace(PERCENT_ESCAPE, decodeEscape) }))
    .map(match => ({ start: match.index + match[0].length - (match[2] ?? '').length, end: match.index + match[0].length }));
}

/** Value ranges of quoted JSON keys whose `\u`-decoded name is a credential name: inside the quotes, or a bare token. */
function escapedKeyRanges({ text }: { readonly text: string }, _optional = {}): ValueRange[] {
  return [...text.matchAll(ESCAPED_KEY_RE)]
    .filter(match => isCredentialName({ name: (match[2] ?? '').replace(UNICODE_ESCAPE, decodeEscape) }))
    .map(match => {
      const end = match.index + match[0].length - (match[3]?.length ?? 0);
      return { start: end - (match[4] ?? match[5] ?? '').length, end };
    });
}

/** Value ranges of parameters and JSON keys whose decoded name is a credential name. `isMasked` tells an already
 * generated marker, which is not a new credential.
 * @param required.text - The text to scan; never mutated. @complexity O(n): bounded work per start. */
export function encodedNameValueRanges(
  { text, isMasked }: { readonly text: string; readonly isMasked: (value: string) => boolean }, _optional = {},
): ValueRange[] {
  return [...escapedParamRanges({ text }), ...escapedKeyRanges({ text })].filter(({ start, end }) => !isMasked(text.slice(start, end)));
}
