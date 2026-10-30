/**
 * @file A linear-time stand-in for the regex tail `\s*(.+)$` / `\s+(.+)$`. In those spellings the
 * whitespace run and `.+` can both match the same characters, so the engine backtracks
 * quadratically on long whitespace runs. A leaf module with no imports.
 */

/** Characters `.` does not match without the `s` flag. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * Returns what `(.+)` captures when `rest` is matched against `\s{minWhitespace,}(.+)$` from its
 * start, or null when that pattern does not match. A whitespace-only `rest` captures its final
 * character, exactly as the greedy regex gives back one character to `.+`.
 * @complexity O(rest length).
 */
export function captureLineTail({ rest }: { rest: string }, { minWhitespace = 0 }: { minWhitespace?: 0 | 1 } = {}): string | null {
  const stripped = rest.trimStart();
  if (stripped !== "") {
    const leading = rest.length - stripped.length;
    return leading >= minWhitespace && !LINE_TERMINATOR.test(stripped) ? stripped : null;
  }
  if (rest.length < minWhitespace + 1) return null;
  const last = rest.slice(-1);
  return LINE_TERMINATOR.test(last) ? null : last;
}
