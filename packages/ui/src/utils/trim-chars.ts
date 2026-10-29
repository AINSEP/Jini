/**
 * Linear-time trimming of a set of characters, in place of `value.replace(/[…]+$/, '')`-style
 * regexes whose engine retries the run from every start position (quadratic on long runs).
 * `chars` is a set of single UTF-16 code units, matched exactly like a non-`u` regex class.
 */
export function trimTrailingChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

/** Leading counterpart of {@link trimTrailingChars}. */
export function trimLeadingChars(value: string, chars: string): string {
  let start = 0;
  while (start < value.length && chars.includes(value[start]!)) start += 1;
  return value.slice(start);
}

/** Both ends — the linear form of `value.replace(/^[…]+|[…]+$/g, '')`. */
export function trimChars(value: string, chars: string): string {
  return trimLeadingChars(trimTrailingChars(value, chars), chars);
}

/** {@link trimTrailingChars} for a character class a plain list cannot spell (e.g. one including `\s`). */
export function trimTrailingWhere(value: string, isTrimmed: (char: string) => boolean): string {
  let end = value.length;
  while (end > 0 && isTrimmed(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}
