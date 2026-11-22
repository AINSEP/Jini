import assert from "node:assert/strict";
import type { Response } from "express";
import { test } from "vitest";

import { ForbiddenError } from "../../../core/index.js";
import {
  FormDefinitionNotFoundError,
  FormFieldValidationError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
  type FormSubmissionRecord,
} from "../../../forms/index.js";
import { mapFormsWriteError, toAdminFormSubmissionDto, toAdminFormSubmissionListResponse } from "../forms.js";

/**
 * @file Characterization of the admin forms HTTP helper after it moved into the engine. The host keeps
 * its original response test (it depends on a host-only capturing-response helper), so this file pins
 * the same error-to-status mapping and the submission DTO's wire shape here, against a minimal
 * hand-rolled response double, so the engine copy is verified on its own.
 */

function capturingResponse(): { res: Response; capture: { statusCode?: number; jsonBody?: unknown } } {
  const capture: { statusCode?: number; jsonBody?: unknown } = {};
  const res = {
    status(code: number) { capture.statusCode = code; return this; },
    json(body: unknown) { capture.jsonBody = body; return this; },
  } as unknown as Response;
  return { res, capture };
}

const errorCases = [
  { error: new ForbiddenError({ message: "write denied", permission: "forms.write", reason: "no_grant" }), status: 403,
    body: { error: "write denied", code: "FORBIDDEN", details: { permission: "forms.write", reason: "no_grant" } } },
  { error: new FormFieldValidationError({ message: "invalid field", fieldErrors: [{ field: "email", reason: "unsupported type" }] }), status: 400,
    body: { error: "invalid field", code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: [{ field: "email", reason: "unsupported type" }] } } },
  { error: new FormSlugConflictError({ message: "slug occupied", slug: "contact" }), status: 409,
    body: { error: "slug occupied", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } },
  { error: new FormDefinitionNotFoundError({ message: "definition absent" }), status: 404,
    body: { error: "definition absent", code: "FORMS_DEFINITION_NOT_FOUND" } },
  { error: new FormSubmissionNotFoundError({ message: "submission absent" }), status: 404,
    body: { error: "submission absent", code: "FORMS_SUBMISSION_NOT_FOUND" } },
];

test("mapFormsWriteError maps each forms domain error to its status and body", () => {
  for (const { error, status, body } of errorCases) {
    const { res, capture } = capturingResponse();
    assert.equal(mapFormsWriteError({ err: error, res }), true);
    assert.deepEqual(capture, { statusCode: status, jsonBody: body });
  }
});

test("mapFormsWriteError leaves an unknown error unhandled and the response untouched", () => {
  const { res, capture } = capturingResponse();
  assert.equal(mapFormsWriteError({ err: new Error("boom"), res }), false);
  assert.deepEqual(capture, {});
});

test("a submission DTO keeps an expired (null) IP as an empty string and copies the answers", () => {
  const data = { email: "a@example.com" };
  const submission = {
    id: "s1", formDefinitionId: "f1", workspaceId: "w1", data, sourceIp: null, submittedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as FormSubmissionRecord;
  const dto = toAdminFormSubmissionDto(submission);
  assert.deepEqual(dto, { id: "s1", formDefinitionId: "f1", workspaceId: "w1", data, sourceIp: "", submittedAt: "2026-01-01T00:00:00.000Z" });
  assert.notEqual(dto.data, data);
  assert.deepEqual(toAdminFormSubmissionListResponse({ items: [submission], nextCursor: "c2" }), { data: [dto], nextCursor: "c2" });
});
