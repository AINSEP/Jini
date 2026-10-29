/**
 * @file Character checks for skill path segments and file paths, as plain code: the regex
 * spellings (`/[/\\\x00]/`, `/[\\\x00-\x1f\x7f:]/`) are control-character classes.
 */

/** Whether `value` contains a path separator (`/` or `\`) or a NUL character. */
export function hasSeparatorOrNul(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.includes("\0");
}

/** Whether `value` contains a backslash, a colon, or a control character (U+0000–U+001F, U+007F). */
export function hasUnsafePathCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c || code === 0x3a) return true;
  }
  return false;
}
