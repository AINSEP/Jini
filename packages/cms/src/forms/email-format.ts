/** Native email syntax shared by the registry and the compatibility submission guard. */
// Match native type=email syntax (WHATWG HTML email state), including single-label domains.
// Do not trim or rewrite answers: Jini's payload contract preserves submitted strings.
const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/** Returns whether the entire value matches native single-address email syntax.
 * JS's $ can match before a final newline; checking the full match refuses that bypass.
 * @complexity O(n) in the address length, bounded by the caller's 5000-character text cap. */
export function isValidFormEmail({ value }: { value: string }, _optional = {}): boolean {
  return EMAIL_PATTERN.exec(value)?.[0] === value;
}
