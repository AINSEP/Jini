/**
 * @module redact-label-aliases
 *
 * Credential labels beyond the engine's own list (`passwd`, `pwd`, `id_token`, `auth_token`,
 * `signing_secret`, `webhook_secret`) and prefixed env-style names (`DB_PASSWORD`, `app_secret`), whose
 * value is masked at any length. The value shapes are the ones the diagnostics rules used: an assignment,
 * a quoted JSON/inspect value, and a colon form that needs a quoted value or a single token of 12+
 * characters so a prose colon ("pwd: the current directory") stays readable. A quoted multiword key that
 * ends in a credential name (`"user password"`) and a prefixed name whose value is a single token on the next
 * line are masked too. No I/O, no host state.
 */
import type { ValueRange } from './redact-auth-schemes.js';
import { isNextLineValue } from './redact-prose-values.js';

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
// The engine's rules cannot read a name right after a `-` (`--token=x`: its label must not follow a hyphen) or a label in
// backslash-escaped JSON (`{\"token\":\"x\"}`), so those forms are read here even for the engine's own names.
const ownedByEngine = ({ name, before, escaped }: { name: string | undefined; before: string | undefined; escaped: boolean }): boolean =>
  isEngineLabelName(name) && before !== '-' && !escaped;
const QUOTED = String.raw`"(?:\\.|[^"\\\r\n])*"?|'(?:\\.|[^'\\\r\n])*'?`;
// `label=value`: the value is one unquoted run or a quoted string; an unclosed quote runs to the line end.
const ASSIGNMENT_RE = new RegExp(`${NAME}[ \\t]*=[ \\t]*(?<value>${QUOTED}|[^\\s"'&,;})]+)`, 'gi');
// A quoted value may hold backslash escapes (`"a\\"b"`, `"C:\\\\keys"`); an escape is read as one unit so an escaped quote
// does not end the value early and a backslash does not stop it (the closing quote still must not be escaped). A quoted
// value may also sit on a later line than the key, as pretty-printed or wrapped JSON puts it.
const NEXT_LINE_QUOTE = String.raw`(?:\r?\n[ \t]*)*`;
// `"label": "value"` and `{ label: 'value' }` (also inside an escaped JSON string), or a bare single token.
const COLON_RE = new RegExp(
  `(?<open>\\\\?["']?)${NAME}\\k<open>[ \\t]*:[ \\t]*`
    + `(?:${NEXT_LINE_QUOTE}(?<quote>\\\\?["'])(?<quoted>(?:(?!\\k<quote>)(?:\\\\[^\\r\\n]|[^\\\\\\r\\n]))+)\\k<quote>|(?<bare>[^\\s"',;}]{12,}))`,
  'gi',
);

// `"user password": "value"`: a quoted key of several words whose last words name a credential. A key with no
// separator is a plain name the rules above already read; this one adds the names they cannot (a space or dot).
const QUOTED_KEY_RE = new RegExp(
  `(?<open>\\\\?["'])(?<name>[A-Za-z0-9][A-Za-z0-9 _.-]{0,160}?)\\k<open>[ \\t]*:[ \\t]*`
    + `${NEXT_LINE_QUOTE}(?<quote>\\\\?["'])(?<quoted>(?:(?!\\k<quote>)(?:\\\\[^\\r\\n]|[^\\\\\\r\\n]))+)\\k<quote>`,
  'g',
);
const CREDENTIAL_KEY_END = /(?:^|[ _.-])(?:password|passwd|pwd|secret|token|api[ _-]?key|private[ _-]?key|access[ _-]?key|secret[ _-]?key|client[ _-]?secret|(?:access|refresh|auth|id)[ _-]?token|(?:signing|webhook)[ _-]?secret)$/i;
// A prefixed name (`DB_PASSWORD=`, `my-token:`) or a standalone alias (`passwd:`) with nothing after the sign, then ONE
// token on the next line: the value of an env file or a wrapped form line. A line that is itself an assignment (`NEXT=1`),
// a heading (`Notes:`), a list item or several plain words is not a value; the line after it is not read.
// After `=` any number of blank lines may separate the name from its value, and the first token of that line is the
// value, as the engine's own rules read `password=` (the `=` form never reads as prose). After a colon blank lines may
// come first too, and the line is read as the engine's labels read it (`isNextLineValue`: one token, or a
// credential-shaped first token followed by more text), so a paragraph of plain words after `passwd:` stays readable.
const NEXT_LINE_VALUE = String.raw`(?<value>${QUOTED}|(?![\w.-]+[=:])[^\s"'&,;})-][^\s"'&,;})]*)`;
const NEXT_LINE_ASSIGNMENT_RE = new RegExp(`${NAME}[ \\t]*=[ \\t]*(?:\\r?\\n[ \\t]*)+${NEXT_LINE_VALUE}`, 'gi');
// The name may be a quoted JSON key (`{"passwd":` then the value on a later line).
const NEXT_LINE_COLON_RE = new RegExp(`(?<open>["']?)${NAME}\\k<open>[ \\t]*:[ \\t]*(?:\\r?\\n[ \\t]*)+${NEXT_LINE_VALUE}`, 'gi');

/** The value's line from its first character, bounded like the engine's colon reading (200 characters). */
const valueLine = ({ text, match }: { readonly text: string; readonly match: RegExpMatchArray }): string => {
  const start = (match.index ?? 0) + match[0].length - (match.groups?.value ?? '').length;
  return /^[^\r\n]*/.exec(text.slice(start, start + 200))?.[0] ?? '';
};

/** Ranges of the quoted value after a multiword quoted credential key. */
function quotedKeyRanges({ text }: { readonly text: string }): ValueRange[] {
  return [...text.matchAll(QUOTED_KEY_RE)]
    .filter(match => CREDENTIAL_KEY_END.test(match.groups?.name ?? '') && !isEngineLabelName(match.groups?.name))
    .map(match => colonValueRange({ match }));
}

/** Ranges of a next-line value after a prefixed name; the engine's own exact names are left to its rules. */
function nextLineRanges({ text }: { readonly text: string }): ValueRange[] {
  const colonValues = [...text.matchAll(NEXT_LINE_COLON_RE)].filter(match => isNextLineValue({ line: valueLine({ text, match }) }));
  return [...text.matchAll(NEXT_LINE_ASSIGNMENT_RE), ...colonValues]
    .filter(match => !ownedByEngine({ name: match.groups?.name, before: text[(match.index ?? 0) - 1], escaped: false }))
    .map(match => assignedValueRange({ match }));
}

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
    .filter(match => !ownedByEngine({ name: match.groups?.name, before: text[(match.index ?? 0) - 1], escaped: false }))
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
    .filter(match => !ownedByEngine({ name: match.groups?.name, before: text[(match.index ?? 0) - 1], escaped: match.groups?.open?.startsWith('\\') === true }))
    .map(match => colonValueRange({ match }));
}

/** Value ranges of aliased and prefixed credential labels. `isMasked` tells an already-generated marker,
 * which is not a new credential. O(n) in the text for fixed pattern work per start.
 * @param required.text - The text to scan; never mutated. */
export function labelAliasValueRanges(
  { text, isMasked }: { readonly text: string; readonly isMasked: (value: string) => boolean },
): ValueRange[] {
  return [...assignmentRanges({ text }), ...colonRanges({ text }), ...quotedKeyRanges({ text }), ...nextLineRanges({ text })]
    .filter(({ start, end }) => end > start && !isMasked(text.slice(start, end)));
}
