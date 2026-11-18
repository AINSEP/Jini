/**
 * @module redact-text-scan
 *
 * Forward-only text scanners the redaction engine builds on: an incremental "next match at or after"
 * finder for value extents, and Knuth-Morris-Pratt literal search for caller-supplied secrets. Pure
 * functions over a string; no I/O, no redaction policy.
 */

/** `forwardFinder` for a quote that skips backslash-escaped ones: an odd run of backslashes before a
 * quote escapes it (`\\"` is an escaped backslash, then a real quote). Same non-decreasing `from` rule.
 * @complexity O(n) over all calls: each quote's backslash run is counted once. */
export function unescapedQuoteFinder(text: string, quote: RegExp): (from: number) => number {
  const next = forwardFinder(text, quote);
  let found = -1;
  return (from) => {
    if (from > found) {
      found = next(from);
      while (found < text.length && isBackslashEscaped(text, found)) found = next(found + 1);
    }
    return found;
  };
}

/** True when an odd run of backslashes ends right before `index`. */
function isBackslashEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  while (text[index - 1 - backslashes] === '\\') backslashes++;
  return backslashes % 2 === 1;
}

/** `find(from)`: the first index at or after `from` matching `pattern`, or `text.length`. `from` must
 * not decrease between calls: one search answers every later `from` up to its result, since nothing
 * matched between the earlier `from` and that result.
 * @complexity O(n) over all calls for n chars. */
export function forwardFinder(text: string, pattern: RegExp): (from: number) => number {
  const regex = new RegExp(pattern.source, 'g');
  let found = -1;
  return (from) => {
    if (from > found) {
      regex.lastIndex = from;
      found = regex.exec(text)?.index ?? text.length;
    }
    return found;
  };
}

/** Calls `visit` with the start of every occurrence of `needle` in order, overlapping ones included.
 * Knuth-Morris-Pratt: after a hit the scan keeps the needle's longest border instead of retrying one
 * character later (which cost Θ(n·m) on long overlapping needles), so no text character is read
 * twice; while no partial match is pending, native indexOf skips to the next occurrence.
 * @complexity O(n + m) time, O(m) space for n text and m needle chars. */
export function forEachOccurrence(text: string, needle: string, visit: (start: number) => void): void {
  const border = borderTable(needle);
  let matched = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    const char = text.charCodeAt(at);
    while (matched > 0 && char !== needle.charCodeAt(matched)) matched = border[matched - 1] ?? 0;
    if (char === needle.charCodeAt(matched)) matched += 1;
    if (matched === needle.length) {
      visit(at + 1 - needle.length);
      matched = border[matched - 1] ?? 0;
    }
    at = nextSearchOffset({ text, needle, at, matched });
  }
}

/** Keep partial KMP matches moving one character at a time; native indexOf skips unmatched runs. */
function nextSearchOffset({ text, needle, at, matched }: { text: string; needle: string; at: number; matched: number }, _options = {}): number {
  const next = at + 1;
  if (next >= text.length) return -1;
  return matched === 0 ? text.indexOf(needle, next) : next;
}

/** KMP failure table: `border[i]` is the length of the longest proper prefix of `needle[0..i]` that
 * is also its suffix. @complexity O(m) time and space. */
function borderTable(needle: string): Int32Array {
  const border = new Int32Array(needle.length);
  let length = 0;
  for (let i = 1; i < needle.length; i += 1) {
    const char = needle.charCodeAt(i);
    while (length > 0 && char !== needle.charCodeAt(length)) length = border[length - 1] ?? 0;
    if (char === needle.charCodeAt(length)) length += 1;
    border[i] = length;
  }
  return border;
}
