import { MemberValidationError } from "./types.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** Normalize + validate an email address. Throws `MemberValidationError` on a bad format. */
export function assertValidEmail({ email }: { email: string }, _optional: Record<string, never> = {}): string {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.indexOf("@") + 1);
  // Preserve the original grammar: a dot needs at least one domain character on each side.
  if (!normalized || !EMAIL_PATTERN.test(normalized) || domain.lastIndexOf(".", domain.length - 2) < 1) {
    throw new MemberValidationError(`'${email}' is not a valid email address`);
  }
  return normalized;
}
