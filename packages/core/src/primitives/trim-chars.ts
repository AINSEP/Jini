/**
 * @file Linear-time trimming of an arbitrary character set from either end of a string. The regex
 * spellings these replace (`s.replace(/\/+$/, '')`, `s.replace(/^-+|-+$/g, '')`) backtrack
 * quadratically on long runs of the trimmed character that do not reach the end, because the
 * engine retries the `+` run from every start position. A leaf module with no imports.
 */

/** Strips every trailing character contained in `chars` (a set of single UTF-16 units).
 *  Same result as `text.replace(/[chars]+$/, '')`. @complexity O(text length). */
export function trimCharsEnd({ text, chars }: { text: string; chars: string }): string {
  let end = text.length;
  while (end > 0 && chars.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** Strips every leading character contained in `chars`. Same result as
 *  `text.replace(/^[chars]+/, '')`. @complexity O(text length). */
export function trimCharsStart({ text, chars }: { text: string; chars: string }): string {
  let start = 0;
  while (start < text.length && chars.includes(text.charAt(start))) start += 1;
  return text.slice(start);
}

/** Strips `chars` from both ends. Same result as `text.replace(/^[chars]+|[chars]+$/g, '')`.
 *  @complexity O(text length). */
export function trimChars({ text, chars }: { text: string; chars: string }): string {
  return trimCharsStart({ text: trimCharsEnd({ text, chars }), chars });
}
