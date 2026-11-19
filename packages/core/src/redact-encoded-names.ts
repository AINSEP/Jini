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
function isCredentialName(name: string): boolean {
  const probe = `?${name}=x`;
  URL_NAME.lastIndex = 0;
  return URL_NAME.exec(probe)?.[0].length === probe.length;
}

/** Value ranges of parameters and JSON keys whose decoded name is a credential name.
 * @param required.text - The text to scan; never mutated. @complexity O(n): bounded work per start. */
export function encodedNameValueRanges({ text }: { readonly text: string }): ValueRange[] {
  const ranges: ValueRange[] = [];
  for (const match of text.matchAll(ESCAPED_PARAM_RE)) {
    if (!isCredentialName((match[1] ?? '').replace(PERCENT_ESCAPE, decodeEscape))) continue;
    const end = (match.index ?? 0) + match[0].length;
    ranges.push({ start: end - (match[2] ?? '').length, end });
  }
  for (const match of text.matchAll(ESCAPED_KEY_RE)) {
    if (!isCredentialName((match[2] ?? '').replace(UNICODE_ESCAPE, decodeEscape))) continue;
    const value = match[4] ?? match[5] ?? '';
    const end = (match.index ?? 0) + match[0].length - (match[3]?.length ?? 0);
    ranges.push({ start: end - value.length, end });
  }
  return ranges;
}
