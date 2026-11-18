/**
 * @module redact-label-aliases
 *
 * Credential labels beyond the engine's own list (`passwd`, `pwd`, `id_token`, `auth_token`,
 * `signing_secret`, `webhook_secret`) and prefixed env-style names (`DB_PASSWORD`, `app_secret`), whose
 * value is masked at any length. The value shapes are the ones the diagnostics rules used: an assignment,
 * a quoted JSON/inspect value, and a colon form that needs a quoted value or a single token of 12+
 * characters so a prose colon ("pwd: the current directory") stays readable. No I/O, no host state.
 */
import type { ValueRange } from './redact-auth-schemes.js';

const LABELS = 'password|passwd|pwd|client_secret|secret_access_key|signing_secret|webhook_secret|api_key|apikey|'
  + 'access_token|refresh_token|id_token|auth_token|private_key|secret|token';
// A name may carry env-style prefix segments (DB_PASSWORD, my-token); it must not start inside a word,
// so `mypwd` and `passwdfile` are other names. Each prefix segment ends at `_` or `-`, so the repeat is
// unambiguous and a long separator run is read once per start.
const NAME = String.raw`(?<![A-Za-z0-9])(?<name>(?:[A-Za-z0-9]{1,32}[_-]){0,6}(?:${LABELS}))`;
// The engine's own label rules already own these exact names and keep their structure (a chained label, an
// empty quoted hint, a truncated quote); a second rule over the same value would widen or re-cut those spans.
const ENGINE_LABEL_NAMES: ReadonlySet<string> = new Set(['password', 'secret', 'token', 'apikey', 'accesstoken', 'refreshtoken', 'clientsecret', 'privatekey']);
const isEngineLabelName = (name: string | undefined): boolean => ENGINE_LABEL_NAMES.has((name ?? '').toLowerCase().replace(/[-_]/g, ''));
const QUOTED = String.raw`"(?:\\.|[^"\\\r\n])*"?|'(?:\\.|[^'\\\r\n])*'?`;
// `label=value`: the value is one unquoted run or a quoted string; an unclosed quote runs to the line end.
const ASSIGNMENT_RE = new RegExp(`${NAME}[ \\t]*=[ \\t]*(?<value>${QUOTED}|[^\\s"'&,;})]+)`, 'gi');
// `"label": "value"` and `{ label: 'value' }` (also inside an escaped JSON string), or a bare single token.
const COLON_RE = new RegExp(
  `(?<open>\\\\?["']?)${NAME}\\k<open>[ \\t]*:[ \\t]*`
    + `(?:(?<quote>\\\\?["'])(?<quoted>(?:(?!\\k<quote>)[^\\\\\\r\\n])+)\\k<quote>|(?<bare>[^\\s"',;}]{12,}))`,
  'gi',
);

/** The value range of an assignment: inside a closed quote pair, after an unclosed opening quote. */
function assignedValueRange({ match }: { readonly match: RegExpMatchArray }): ValueRange {
  const value = match.groups?.value ?? '';
  const end = (match.index ?? 0) + match[0].length;
  const start = end - value.length;
  if (!/^["']/.test(value)) return { start, end };
  return { start: start + 1, end: value.length > 1 && value.endsWith(value[0]!) ? end - 1 : end };
}

/** Ranges after `label=`; names the engine's own rules own are left to them. */
function assignmentRanges({ text }: { readonly text: string }): ValueRange[] {
  return [...text.matchAll(ASSIGNMENT_RE)]
    .filter(match => !isEngineLabelName(match.groups?.name))
    .map(match => assignedValueRange({ match }));
}

/** The value range of a colon match: inside its quotes, or the bare token. */
function colonValueRange({ match }: { readonly match: RegExpMatchArray }): ValueRange {
  const { quoted, bare, quote } = match.groups ?? {};
  const end = (match.index ?? 0) + match[0].length - (quote?.length ?? 0);
  return { start: end - (quoted ?? bare ?? '').length, end };
}

/** Ranges after `label:` in a quoted value or a single long token. */
function colonRanges({ text }: { readonly text: string }): ValueRange[] {
  return [...text.matchAll(COLON_RE)]
    .filter(match => !isEngineLabelName(match.groups?.name))
    .map(match => colonValueRange({ match }));
}

/** Value ranges of aliased and prefixed credential labels. `isMasked` tells an already-generated marker,
 * which is not a new credential. O(n) in the text for fixed pattern work per start.
 * @param required.text - The text to scan; never mutated. */
export function labelAliasValueRanges(
  { text, isMasked }: { readonly text: string; readonly isMasked: (value: string) => boolean },
): ValueRange[] {
  return [...assignmentRanges({ text }), ...colonRanges({ text })]
    .filter(({ start, end }) => end > start && !isMasked(text.slice(start, end)));
}
