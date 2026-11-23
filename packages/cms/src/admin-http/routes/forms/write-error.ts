import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { ForbiddenError as CommandForbiddenError } from "../../../core/index.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import {
  FormDefinitionNotFoundError,
  FormFieldValidationError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
} from "../../../forms/index.js";

/**
 * @file Shared error -> HTTP mapping for the admin `forms` write routes (errors.spec.md §2/§6), as
 * a status plus the flat body the host writes. Framework-neutral: a route spec throws it as a
 * refusal (`rejectFormsWriteError`); a host's own hand-written route writes the same pair itself.
 */

/** One mapped answer: the HTTP status and the exact JSON body. */
export interface FormsWriteErrorAnswer { status: number; body: Record<string, unknown> }

/** Each recognized write error class and how it answers, in match order. */
const FORMS_WRITE_ERROR_ANSWERS: ReadonlyArray<{ matches: (err: unknown) => boolean; answer: (err: never, message: string) => FormsWriteErrorAnswer }> = [
  { matches: (err) => err instanceof ToolInputError, answer: (err: ToolInputError, message) => ({ status: 400, body: { error: message, code: "VALIDATION_ERROR" } }) },
  { matches: (err) => err instanceof RecordVersionConflictError, answer: (err: RecordVersionConflictError) => ({ status: 409, body: { ...versionConflictBody({ error: err }) } }) },
  { matches: (err) => err instanceof CommandForbiddenError, answer: (err: CommandForbiddenError, message) => ({ status: 403, body: {
    error: message,
    code: "FORBIDDEN",
    details: { permission: err.permission, reason: err.reason },
  } }) },
  { matches: (err) => err instanceof FormFieldValidationError, answer: (err: FormFieldValidationError, message) => ({ status: 400, body: {
    error: message,
    code: "FORMS_FIELD_VALIDATION_ERROR",
    details: { fieldErrors: err.fieldErrors },
  } }) },
  { matches: (err) => err instanceof FormSlugConflictError, answer: (err: FormSlugConflictError, message) => ({ status: 409, body: { error: message, code: "FORMS_SLUG_CONFLICT", details: { slug: err.slug } } }) },
  { matches: (err) => err instanceof FormDefinitionNotFoundError, answer: (err: FormDefinitionNotFoundError, message) => ({ status: 404, body: { error: message, code: "FORMS_DEFINITION_NOT_FOUND" } }) },
  { matches: (err) => err instanceof FormSubmissionNotFoundError, answer: (err: FormSubmissionNotFoundError, message) => ({ status: 404, body: { error: message, code: "FORMS_SUBMISSION_NOT_FOUND" } }) },
];

/**
 * The status and body for a recognized forms/core write error; `undefined` for an unrecognized
 * error (the caller falls through to its own generic 500). The classification (status, code,
 * details) stays here; the `error` copy is the host's `outwardErrorMessage` for the error.
 *
 * @complexity O(n) in the fixed mapping table length.
 */
export function formsWriteErrorAnswer({ err, outwardErrorMessage }: { err: unknown; outwardErrorMessage: OutwardErrorMessage }, _optional: Record<string, never> = {}): FormsWriteErrorAnswer | undefined {
  const entry = FORMS_WRITE_ERROR_ANSWERS.find((candidate) => candidate.matches(err));
  // Every matched class is an `Error` subclass, so the host port always receives one.
  return entry ? entry.answer(err as never, outwardErrorMessage({ error: err as Error })) : undefined;
}

/**
 * Refuses with the mapped answer; anything unmapped is rethrown unchanged so the host's error
 * port answers it as an unexpected failure.
 *
 * @complexity O(n) in the fixed mapping table length.
 */
export function rejectFormsWriteError({ err, outwardErrorMessage }: { err: unknown; outwardErrorMessage: OutwardErrorMessage }, _optional: Record<string, never> = {}): never {
  const answer = formsWriteErrorAnswer({ err, outwardErrorMessage });
  if (answer) throw new RouteRefusalError(answer);
  throw err;
}
