/**
 * @file One translation entry as a spreadable object: `{ ...translationEntry({ source, translated }) }`
 * is exactly `{ [source]: translated }` at the same position in the dictionary.
 *
 * Why it exists: `sonarjs/no-hardcoded-passwords` treats any dictionary property whose key text
 * mentions "password" and whose value is a whitespace-free, high-entropy string as a credential.
 * CJK, Thai and Bengali copy has no spaces, so labels like `"Reset password?": "パスワードをリセット"`
 * read as hardcoded passwords. Entries about passwords are written through this helper so the
 * source string is data, not a property key, and real credential literals stay detectable.
 */
export function translationEntry({ source, translated }: { source: string; translated: string }, _options = {}): Record<string, string> {
  return { [source]: translated };
}
