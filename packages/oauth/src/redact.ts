/** Redaction policy is provider-owned; the operation keeps every other byte intact. */
export function redactOAuthUrls({ text, pattern, replacement }: { text: string; pattern: RegExp; replacement: string }): string {
  return text.replace(pattern, replacement);
}
