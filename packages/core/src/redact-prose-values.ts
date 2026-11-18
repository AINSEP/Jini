/**
 * @module redact-prose-values
 *
 * Decides whether the text after "label:" is prose or a placeholder rather than a credential value. A
 * colon is how sentences, form transcripts and documentation introduce things ("Password: (skipped)",
 * "password: must be at least 8 characters"); an assignment (`=`) never gets this reading. A single token
 * that does not look like prose ("API key: abc") is still a credential. No I/O, no host state.
 */

// Words that say "no value was given". Matched whole, with optional closing sentence punctuation.
const NO_VALUE_WORDS = 'none|n\\/a|na|null|nil|yes|no|true|false|tbd|todo|empty|unknown|unset|required|optional|pending|missing|hidden|redacted|masked|skipped|needed';
const PLACEHOLDER_RES: readonly RegExp[] = [
  // "(skipped)", "(none)", "(not provided)": a short parenthesised phrase of letters.
  /^\([A-Za-z][A-Za-z -]{0,24}\)/,
  new RegExp(`^(?:${NO_VALUE_WORDS})[.!?,;:)]*(?=\\s|$)`, 'i'),
  // A masked display ("******", "•••").
  /^[*•●]+(?=\s|$)/,
  // The start of a sentence: a letters-only word followed by another word. A key or password carries
  // digits or symbols, or ends the value; a plain-word value with more words after it reads as prose.
  /^[A-Za-z]+[ \t]+[A-Za-z]/,
];

/**
 * True when the unquoted value after a colon should be left readable.
 * @param required.rest - The text from the first value character to the end of its line.
 * @param required.gap - The text between the colon and that character. A line break in it means the value
 *   is empty and `rest` belongs to the next line.
 * @complexity O(1): every pattern is anchored and bounded by the first word.
 */
export function isProseAfterColon({ rest, gap }: { readonly rest: string; readonly gap: string }): boolean {
  return /[\r\n]/.test(gap) || PLACEHOLDER_RES.some(pattern => pattern.test(rest));
}
