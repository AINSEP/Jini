/**
 * @module redact-prose-values
 *
 * Decides whether the text after "label:" is prose or a placeholder rather than a credential value. A
 * colon is how sentences, form transcripts and documentation introduce things ("Password: (skipped)",
 * "password: must be at least 8 characters"); an assignment (`=`) never gets this reading. A single token
 * that does not look like prose ("API key: abc") is still a credential. No I/O, no host state.
 */

// Chat's question-form answer line once carried this note, now deleted with its workaround: One answer line.
// Chat's "(skipped)" placeholder never reaches the redactor: after a label such as "API key:" the shared engine
// reads the next word as a credential value. The placeholder rule below owns that case for every caller.
// Words that say "no value was given". Matched whole, with optional closing sentence punctuation.
const NO_VALUE_WORDS = 'none|n\\/a|na|null|nil|yes|no|true|false|tbd|todo|empty|unknown|unset|required|optional|pending|missing|hidden|redacted|masked|skipped|needed';
const PLACEHOLDER_RES: readonly RegExp[] = [
  // "(skipped)", "(none)", "(not provided)": a short parenthesised phrase of letters.
  /^\([A-Za-z][A-Za-z -]{0,24}\)/,
  new RegExp(`^(?:${NO_VALUE_WORDS})[.!?,;:)]*(?=\\s|$)`, 'i'),
  // A masked display ("******", "•••").
  /^[*•●]+(?=\s|$)/,
];
// The start of a sentence: a letters-only word followed by another word. A key or password carries digits or
// symbols, or ends the value, so a plain-word value with more words after it reads as prose, but only where
// no credential syntax is in play (see isFieldStart): after a label that starts its line the first word must
// be an ordinary function word ("Password: Must be 8 chars"), not a word that could be the credential itself.
const SENTENCE_START = /^[A-Za-z]+[ \t]+[A-Za-z]/;
const FUNCTION_WORD_START = new RegExp(`^(?:${[
  'a', 'an', 'the', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'must', 'should', 'would', 'could', 'can', 'cannot', 'will',
  'shall', 'may', 'might', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'not', 'no', 'never', 'your', 'you',
  'my', 'our', 'their', 'his', 'her', 'we', 'they', 'i', 'if', 'when', 'what', 'which', 'who', 'how', 'why', 'where', 'while', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'from', 'by', 'as', 'and', 'or', 'but', 'then', 'so', 'also', 'only', 'just', 'please', 'see', 'use', 'set', 'enter', 'type',
  'choose', 'select', 'provide', 'add', 'change', 'reset', 'forgot', 'forgotten', 'lost', 'required', 'needed', 'invalid', 'incorrect', 'wrong',
  'expired', 'missing', 'empty', 'blank', 'help', 'hint', 'note', 'remember',
].join('|')})[ \\t]`, 'i');
// A single word this long is never read as the start of a sentence: the rules chat used before masked any 12+ character
// token after a credential label, and a long letters-only password typed mid-sentence ("my password: <word> thanks")
// must stay masked. Sentences after a label start with short words.
const OPAQUE_WORD_MIN = 12;
// A sentence about the credential that begins with the label's own word ("Password: Passwords expire every 90 days")
// or with a plural credential noun ("Token: Passwords expire...") is a policy line, not a passphrase: nobody's password
// is the name of the field, or a word for credentials in general, followed by more words.
const PLURAL_CREDENTIAL_NOUN = /^(?:passwords|passphrases|tokens|secrets|keys|credentials|cookies)$/;
const startsWithLabelWord = ({ rest, label }: { rest: string; label: string }): boolean => {
  const word = /^[A-Za-z]+/.exec(rest)?.[0].toLowerCase() ?? '';
  const name = label.toLowerCase();
  return (name !== '' && (word === name || word === `${name}s`)) || PLURAL_CREDENTIAL_NOUN.test(word);
};
// A label that starts its line (after a list marker, a number or a bracket) is an assignment, not a sentence.
const NUMBERED_LIST_PREFIX = /^\s*\d+[.)]\s+/;
const isFieldStart = (before: string): boolean => !/[A-Za-z0-9]/.test(before.replace(NUMBERED_LIST_PREFIX, ''));
// The line after a label ("Password:" then "hunter2") holds its value when it is one token, or when its first token is
// shaped like a credential (a quoted string, letters with digits, or 12+ characters) even with more text after it
// ("<key> --verbose"); blank lines may come first. A list item ("- Notes: x"), another label ("Notes:"), or a line of
// plain words is the next thing in a form or a paragraph, not a value. This is how the rules chat used before read it.
const CREDENTIAL_SHAPED_TOKEN = /^(?:["'][^\s"']+["']|(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[^\s]+|[^\s]{12,})(?=\s|$)/;
/** True when `line` (the text of the first non-blank line after a label, to its end) starts with the label's value.
 * @complexity O(line): every pattern is anchored. */
export function isNextLineValue({ line }: { readonly line: string }): boolean {
  if (/^[-*•]/.test(line) || /^[\w.-]+[=:]/.test(line)) return false;
  return /^[^\s]+[ \t]*$/.test(line) || CREDENTIAL_SHAPED_TOKEN.test(line);
}
// Several plain words after a field-start label ("password: correct horse battery staple") are a passphrase.
const PASSPHRASE = /^[A-Za-z]+(?:[ \t]+[A-Za-z]+){1,7}[.!?]?[ \t]*$/;

// `key` also names a database or sorting column ("Sort key: name", "Primary key: 1"). After a colon, a short value
// behind one of these qualifiers is an answer, not a credential. The list is closed on purpose: any other word
// before `key` (`secret key`, `private key`, `signing key`) keeps the strict reading, and a bare `key: abc` is
// still masked. The `=` form never gets this reading.
const KEY_QUALIFIER_BEFORE = /(?:^|[^A-Za-z])(?:sort|primary|foreign|partition|cache|group|order|hash|map|composite|unique|lookup|index|natural|surrogate|join|shard|clustering|search|row)[ \t]+$/i;
const QUALIFIED_KEY_MAX_VALUE = 11;
// A longer answer is kept when it reads as a column name (`customerLastName`, `tenant_id_shard_bucket`), as the
// formatter chat used before kept it: words of letters joined by `_`/`-` or camel case, at most a short number at the
// end of a word. A random value changes case or digit class mid-word (`Zq8wPx3m...`) or carries a long digit run.
const IDENTIFIER_WORD = /^[A-Za-z][a-z]*(?:[A-Z][a-z]+)*\d{0,4}$/;
const isReadableIdentifier = (value: string): boolean => value.split(/[_-]/).every(word => IDENTIFIER_WORD.test(word));

const isQualifiedKey = ({ before, label, value }: { before: string; label: string; value: string }): boolean =>
  label.toLowerCase() === 'key' && (value.length <= QUALIFIED_KEY_MAX_VALUE || isReadableIdentifier(value))
  && KEY_QUALIFIER_BEFORE.test(before);



/**
 * True when the unquoted value after a colon should be left readable.
 * @param required.rest - The text from the first value character to the end of its line.
 * @param required.gap - The text between the colon and that character. A line break in it means the value
 *   is on a later line, which is a credential only as {@link isNextLineValue} reads it.
 * @param context.before - The text before the label on its line (qualifier words such as "Sort").
 * @param context.label - The credential word before the colon, as written.
 * @param context.token - The length of the value's first token.
 * @complexity O(1): every pattern is anchored and bounded by the first word.
 */
export function isProseAfterColon(
  { rest, gap }: { readonly rest: string; readonly gap: string },
  { before, label, token }: { readonly before: string; readonly label: string; readonly token: number },
): boolean {
  if (isQualifiedKey({ before, label, value: rest.slice(0, token) }) || PLACEHOLDER_RES.some(pattern => pattern.test(rest))) return true;
  // A header name never heads a paragraph: whatever starts the line after `Authorization:` is its credential.
  if (gap.includes('\n')) return label.toLowerCase() !== 'authorization' && !isNextLineValue({ line: rest });
  if (!SENTENCE_START.test(rest) || token >= OPAQUE_WORD_MIN) return false;
  return !isFieldStart(before) || FUNCTION_WORD_START.test(rest) || startsWithLabelWord({ rest, label });
}

/** Length of the value to mask when a field-start label is followed by a plain-word passphrase, which runs to the
 * line end; 0 otherwise (the value is its first token). @complexity O(1): anchored and bounded to eight words. */
function passphraseLength({ rest, before }: { readonly rest: string; readonly before: string }): number {
  return isFieldStart(before) && PASSPHRASE.test(rest) ? rest.trimEnd().length : 0;
}

/** The text between the colon and the value, or undefined when the label is followed by `=` or no colon at all. */
function colonGap({ match }: { readonly match: RegExpExecArray }): string | undefined {
  const head = match[0].slice(0, -1);
  const colon = head.indexOf(':');
  return colon === -1 || head.includes('=') ? undefined : head.slice(colon + 1);
}

/** After a colon (never `=`), an unquoted value that reads as prose or a placeholder is not a credential:
 * "Password: (skipped)", "password: must be at least 8 characters". The scan resumes at the value. */
// A passphrase of plain words after a field-start label widens the value from its first token to the line end; a
// quoted value is never prose, and `colonGap` is undefined for `=` or a missing colon, which never read as prose.
// The window before the label is bounded to 200 characters so a long line with many labels costs O(1) per label.
export function colonReading(
  { text, match, start, value }: { readonly text: string; readonly match: RegExpExecArray; readonly start: number; readonly value: { readonly end: number; readonly quoted: boolean } },
): { readonly prose: boolean; readonly end: number } {
  const gap = colonGap({ match });
  if (value.quoted || gap === undefined) return { prose: false, end: value.end };
  const rest = /^[^\r\n]*/.exec(text.slice(start, start + 200))?.[0] ?? '';
  const labelStart = match.index + (match[1] ?? '').length;
  const window = text.slice(Math.max(0, labelStart - 200), labelStart);
  const before = window.slice(window.lastIndexOf('\n') + 1);
  if (isProseAfterColon({ rest, gap }, { before, label: match[2] ?? '', token: value.end - start })) return { prose: true, end: value.end };
  const phrase = passphraseLength({ rest, before });
  return { prose: false, end: phrase > value.end - start && !gap.includes('\n') ? start + phrase : value.end };
}
