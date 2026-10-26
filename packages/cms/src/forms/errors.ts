/** Stable domain error types; callers map them to their own transport errors. */
export const FORM_SUBMISSION_TOO_FAST_MESSAGE = "Please wait a moment, then submit again.";

/** Retryable timing refusal before any upload, attempt claim or durable write. */
export class FormSubmissionTooFastError extends Error {
  readonly code = "FORMS_SUBMISSION_TOO_FAST";
  constructor(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    super(FORM_SUBMISSION_TOO_FAST_MESSAGE);
  }
}

export class FormFieldValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;
  constructor({ message, fieldErrors = [] }: { message: string; fieldErrors?: Array<{ field: string; reason: string }> | undefined }) { super(message); this.fieldErrors = fieldErrors; }
}
export class FormSubmissionValidationError extends Error {
  readonly fieldErrors: Array<{ field: string; reason: string }>;
  constructor({ message, fieldErrors = [] }: { message: string; fieldErrors?: Array<{ field: string; reason: string }> | undefined }) { super(message); this.fieldErrors = fieldErrors; }
}
export class FormSlugConflictError extends Error {
  readonly slug: string;
  constructor({ message, slug }: { message: string; slug: string }) { super(message); this.slug = slug; }
}
/** Disabled definitions deliberately use the same not-found error as missing definitions. */
export class FormDefinitionNotFoundError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}
export class FormSubmissionNotFoundError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}
export class FormRateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor({ message, retryAfterSeconds }: { message: string; retryAfterSeconds: number }) { super(message); this.retryAfterSeconds = retryAfterSeconds; }
}
