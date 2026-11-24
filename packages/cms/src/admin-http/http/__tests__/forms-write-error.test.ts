import { describe, expect, it } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";

import { ForbiddenError } from "../../../core/index.js";
import { FormDefinitionNotFoundError, FormFieldValidationError, FormSlugConflictError, FormSubmissionNotFoundError } from "../../../forms/index.js";
import { formsWriteErrorWire } from "../forms-write-error.js";

/** @file F4.4: one typed failure at a time. Mutation: drop details or map a not-found error to 500. */

const errorCases = [
  { label: "forbidden", error: new ForbiddenError({ message: "write denied", permission: "forms.write", reason: "no_grant" }), status: 403,
    body: { error: "write denied", code: "FORBIDDEN", details: { permission: "forms.write", reason: "no_grant" } } },
  { label: "field validation", error: new FormFieldValidationError({ message: "invalid field", fieldErrors: [{ field: "email", reason: "unsupported type" }] }), status: 400,
    body: { error: "invalid field", code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: [{ field: "email", reason: "unsupported type" }] } } },
  { label: "slug conflict", error: new FormSlugConflictError({ message: "slug occupied", slug: "contact" }), status: 409,
    body: { error: "slug occupied", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } },
  { label: "definition not found", error: new FormDefinitionNotFoundError({ message: "definition absent" }), status: 404,
    body: { error: "definition absent", code: "FORMS_DEFINITION_NOT_FOUND" } },
  { label: "submission not found", error: new FormSubmissionNotFoundError({ message: "submission absent" }), status: 404,
    body: { error: "submission absent", code: "FORMS_SUBMISSION_NOT_FOUND" } },
  { label: "tool input", error: new ToolInputError({ message: "bad input" }), status: 400,
    body: { error: "bad input", code: "VALIDATION_ERROR" } },
];

describe("formsWriteErrorWire", () => {
  for (const { label, error, status, body } of errorCases) {
    it(`sends exact ${label} status and details`, () => {
      expect(formsWriteErrorWire({ err: error })).toEqual({ status, body });
    });
  }

  it("maps a version conflict to the shared conflict body at 409", () => {
    const err = new RecordVersionConflictError({ recordKind: "form", recordId: "f1", expectedVersion: 1, currentVersion: 2 });
    expect(formsWriteErrorWire({ err })).toEqual({ status: 409, body: versionConflictBody({ error: err }) });
  });

  it("leaves an unknown error unmapped so the caller falls back to its generic 500", () => {
    expect(formsWriteErrorWire({ err: new Error("private db path") })).toBeNull();
  });
});
