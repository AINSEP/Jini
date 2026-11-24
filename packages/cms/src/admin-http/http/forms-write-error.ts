import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";
import {
  FormDefinitionNotFoundError,
  FormFieldValidationError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
} from "../../forms/index.js";
import { ForbiddenError as CommandForbiddenError } from "../../core/index.js";

/**
 * @file Wire mapping for the admin `forms` routes: forms/core errors to an HTTP status and body
 * (errors.spec.md §2/§6). Framework-free — it returns the wire answer and a host's adapter (Express, for example)
 * writes it, so this module never sees a `Response`. The DTO projections sit beside it in
 * `./forms`.
 */

/** What the host writes: the HTTP status and the JSON body. */
export interface FormsWriteErrorWire { readonly status: number; readonly body: unknown }

const wire = (status: number, body: unknown): FormsWriteErrorWire => ({ status, body });

/** Errors that carry their own detail shape, tried before the per-form errors. */
function coreErrorWire({ err }: { err: unknown }, _optional = {}): FormsWriteErrorWire | null {
  if (err instanceof ToolInputError) return wire(400, { error: err.message, code: "VALIDATION_ERROR" });
  if (err instanceof RecordVersionConflictError) return wire(409, versionConflictBody({ error: err }));
  if (err instanceof CommandForbiddenError) {
    return wire(403, { error: err.message, code: "FORBIDDEN", details: { permission: err.permission, reason: err.reason } });
  }
  return null;
}

/**
 * Shared error -> HTTP mapping for every admin `forms` route (errors.spec.md §2/§6). Returns the
 * status and body for a recognised error; `null` for an unrecognised one (the caller falls through
 * to its own generic 500).
 * @complexity O(1), no I/O.
 */
export function formsWriteErrorWire({ err }: { err: unknown }, _optional = {}): FormsWriteErrorWire | null {
  const core = coreErrorWire({ err });
  if (core) return core;
  if (err instanceof FormFieldValidationError) {
    return wire(400, { error: err.message, code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: err.fieldErrors } });
  }
  if (err instanceof FormSlugConflictError) return wire(409, { error: err.message, code: "FORMS_SLUG_CONFLICT", details: { slug: err.slug } });
  if (err instanceof FormDefinitionNotFoundError) return wire(404, { error: err.message, code: "FORMS_DEFINITION_NOT_FOUND" });
  if (err instanceof FormSubmissionNotFoundError) return wire(404, { error: err.message, code: "FORMS_SUBMISSION_NOT_FOUND" });
  return null;
}
