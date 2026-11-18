/**
 * @module redact-quoted-hints
 *
 * A quoted string that ends in a credential label and its sign (`"password: "`, `"api_key="`) is a hint that a value
 * follows: in source text it is concatenated (`"password: " + value`), so the hint itself is masked and what follows is
 * left to the other rules. No I/O, no host state.
 */
import type { ValueRange } from './redact-auth-schemes.js';

// A value glued right after a hint's closing quote (`"password: "<value>""`, a nested quote pasted without escapes) is
// the credential itself; a hint followed by a space, `+` or punctuation is concatenation and keeps what follows.
const GLUED_HINT_VALUE = /[^\s"'`,;)}\]+]+/y;

/** Ranges of each quoted hint's inside and of a value glued after its closing quote.
 * @param required.quoted - Regex source of one quoted string. @param required.hint - Tests a string's inside.
 * @complexity O(n) for the quoted strings of an n-character text. */
export function quotedHintRanges({ text, quoted, hint }: { readonly text: string; readonly quoted: string; readonly hint: RegExp }): ValueRange[] {
  const glued = new RegExp(GLUED_HINT_VALUE.source, 'y');
  const ranges: ValueRange[] = [];
  for (const match of text.matchAll(new RegExp(quoted, 'g'))) {
    if (!hint.test(match[0].slice(1, -1))) continue;
    const end = match.index + match[0].length;
    ranges.push({ start: match.index + 1, end: end - 1 });
    glued.lastIndex = end;
    const value = glued.exec(text)?.[0];
    if (value) ranges.push({ start: end, end: end + value.length });
  }
  return ranges;
}
