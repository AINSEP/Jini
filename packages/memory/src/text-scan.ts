/**
 * @file Linear-time replacements for regex spellings that backtrack quadratically. This package has
 * no runtime dependencies, so these few scans live here rather than coming from `@jini-ai/core`.
 */

/** Characters `.` does not match without the `s` flag. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/** Drops every trailing `char`, as `text.replace(/c+$/, '')` would. @complexity O(text length). */
export function trimTrailing(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
}

/** Drops leading and trailing `char`, as `text.replace(/^c+|c+$/g, '')` would. @complexity O(text length). */
export function trimBoth(text: string, char: string): string {
  let start = 0;
  while (start < text.length && text[start] === char) start += 1;
  return trimTrailing(text.slice(start), char);
}

/**
 * Splits `label: value` at the first colon, exactly as `/^(label):\s*(.*)$/` matches a line whose
 * label pattern cannot contain a colon: `null` unless `label` accepts the text before the colon and
 * the value (leading whitespace dropped) is a single line. @complexity O(line length).
 */
export function splitLabeledLine({ line, label }: { line: string; label: RegExp }): { label: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const name = line.slice(0, colon);
  const value = line.slice(colon + 1).trimStart();
  if (!label.test(name) || LINE_TERMINATOR.test(value)) return null;
  return { label: name, value };
}

/** The span from the first `{` to the last `}` after it, as `/\{[\s\S]*\}/.exec(text)?.[0]` finds. */
export function outermostBraces(text: string): string | null {
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  return open !== -1 && close > open ? text.slice(open, close + 1) : null;
}
