import { FormSubmissionValidationError } from "./errors.js";
import { isHoneypotTripped, validateSubmissionPayload, type FieldError } from "./forms.js";
import type { FormDefinitionRecord } from "./types.js";

import { isValidFormEmail } from "./email-format.js";

/** Compatibility guard until Jini validates email fields itself. Lookup remains the first step;
 * disabled forms and honeypots retain the package's response before any validation or writes. */
export function assertSubmissionEmails(
  { definition, body }: { definition: FormDefinitionRecord; body: Record<string, unknown> },
  _optional = {},
): void {
  if (definition.status !== "active" || isHoneypotTripped({ hp: body._hp })) return;
  const validation = validateSubmissionPayload({ definition, body });
  const existing: FieldError[] = validation.valid ? [] : validation.fieldErrors;
  const invalid = new Set(definition.fields.filter((field) => {
    const value = body[field.id];
    if (field.type !== "email" || typeof value !== "string" || value === "") return false;
    if (existing.some((error) => error.field === field.id)) return false;
    // JS's $ can match before a final newline; comparing the full match refuses that bypass.
    return !isValidFormEmail({ value });
  }).map((field) => field.id));
  if (invalid.size === 0) return;
  const declared = new Set(definition.fields.map((field) => field.id));
  const fieldErrors: FieldError[] = existing.filter((error) => !declared.has(error.field));
  for (const field of definition.fields) {
    fieldErrors.push(...existing.filter((error) => error.field === field.id));
    if (invalid.has(field.id)) fieldErrors.push({ field: field.id, reason: "invalid_email" });
  }
  // The existing localized renderer maps invalid_email to "Please check {label}." in every locale.
  throw new FormSubmissionValidationError({ message: "submission failed field validation", fieldErrors });
}
