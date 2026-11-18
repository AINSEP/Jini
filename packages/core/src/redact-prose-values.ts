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
// A label that starts its line (after a list marker, a number or a bracket) is an assignment, not a sentence.
const NUMBERED_LIST_PREFIX = /^\s*\d+[.)]\s+/;
const isFieldStart = (before: string): boolean => !/[A-Za-z0-9]/.test(before.replace(NUMBERED_LIST_PREFIX, ''));
// A single token alone on the line after the label ("Password:" then "hunter2") is its value; a list item
// ("- Notes: x"), another label ("Notes:"), or several words is the next thing in a form, not a value.
const isSingleTokenLine = (rest: string): boolean => /^[^\s]+[ \t]*$/.test(rest) && !/^[-*•]/.test(rest) && !/^[\w.-]+[=:]/.test(rest);
// Several plain words after a field-start label ("password: correct horse battery staple") are a passphrase.
const PASSPHRASE = /^[A-Za-z]+(?:[ \t]+[A-Za-z]+){1,7}[.!?]?[ \t]*$/;

// `key` also names a database or sorting column ("Sort key: name", "Primary key: 1"). After a colon, a short value
// behind one of these qualifiers is an answer, not a credential. The list is closed on purpose: any other word
// before `key` (`secret key`, `private key`, `signing key`) keeps the strict reading, and a bare `key: abc` is
// still masked. The `=` form never gets this reading.
const KEY_QUALIFIER_BEFORE = /(?:^|[^A-Za-z])(?:sort|primary|foreign|partition|cache|group|order|hash|map|composite|unique|lookup|index|natural|surrogate|join|shard|clustering|search|row)[ \t]+$/i;
const QUALIFIED_KEY_MAX_VALUE = 11;

/**
 * True when the unquoted value after a colon should be left readable.
 * @param required.rest - The text from the first value character to the end of its line.
 * @param required.gap - The text between the colon and that character. A line break in it means the value
 *   is on the next line, which is a credential only when it is one bare token.
 * @param optional.before - The text before the label on its line (qualifier words such as "Sort").
 * @param optional.label - The credential word before the colon, as written.
 * @param optional.token - The length of the value's first token.
 * @complexity O(1): every pattern is anchored and bounded by the first word.
 */
export function isProseAfterColon(
  { rest, gap }: { readonly rest: string; readonly gap: string },
  { before = '', label = '', token = 0 }: { readonly before?: string; readonly label?: string; readonly token?: number } = {},
): boolean {
  if (label.toLowerCase() === 'key' && token <= QUALIFIED_KEY_MAX_VALUE && KEY_QUALIFIER_BEFORE.test(before)) return true;
  if (PLACEHOLDER_RES.some(pattern => pattern.test(rest))) return true;
  const breaks = gap.match(/\n/g)?.length ?? 0;
  if (breaks > 0) return breaks > 1 || !isSingleTokenLine(rest);
  return SENTENCE_START.test(rest) && (!isFieldStart(before) || FUNCTION_WORD_START.test(rest));
}

/** Length of the value to mask when a field-start label is followed by a plain-word passphrase, which runs to the
 * line end; 0 otherwise (the value is its first token). @complexity O(1): anchored and bounded to eight words. */
export function passphraseLength({ rest, before }: { readonly rest: string; readonly before: string }): number {
  return isFieldStart(before) && PASSPHRASE.test(rest) ? rest.trimEnd().length : 0;
}
