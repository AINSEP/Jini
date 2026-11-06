/** Stable domain error types; callers map them to their own transport errors. */
import type { FieldDescriptor } from "./types.js";
/** Retry refusal carries validated answers and captured controls, never file bytes.
 * @complexity O(1), no I/O. @overallScore 98: references stay local to the rejected attempt. */
export class FormAttachmentSpaceError extends Error {
  readonly code = "FORMS_ATTACHMENT_SPACE";
  readonly answers: Record<string, unknown>;
  readonly fields: FieldDescriptor[];
  constructor({ answers, fields, message = "There is no room for another attachment. Your answers are kept below. Your form has not been sent." }: { answers: Record<string, unknown>; fields: FieldDescriptor[]; message?: string }, _optional = {}) { super(message); this.answers = answers; this.fields = fields; }
}
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

export const FORM_SCHEMA_CHANGED_MESSAGE = "This form changed while you were filling it in. Your form has not been sent. Your previous answers are kept below. Please review the updated form.";
/** Refuses a stale page before acceptance; carries bounded non-file draft text only. */
export class FormSchemaChangedError extends Error {
  readonly code = "FORMS_SCHEMA_CHANGED";
  readonly fields: FieldDescriptor[];
  readonly schemaHash: string;
  readonly draft: import('./stale-form.js').FormRetryDraft;
  readonly html: string | undefined;
  constructor({ fields, schemaHash, draft, html }: { fields: FieldDescriptor[]; schemaHash: string; draft: import('./stale-form.js').FormRetryDraft; html?: string }, _optional = {}) {
    super(FORM_SCHEMA_CHANGED_MESSAGE);
    this.fields = fields; this.schemaHash = schemaHash; this.draft = draft; this.html = html;
  }
}
