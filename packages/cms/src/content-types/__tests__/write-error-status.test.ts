import assert from "node:assert/strict";
import { test } from "vitest";
import { EntityNotLiveError } from "../../core/entity-liveness.js";
import {
  ContentTypeAlreadyExistsError,
  ContentTypeLifecycleError,
  ContentTypeNotFoundError,
  ForbiddenError,
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidFieldShapeError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
  ValidationError,
  VersionConflictError,
} from "../errors.js";
import { contentTypeWriteErrorStatus } from "../write-error-status.js";

/** The register, update-fields and lifecycle routes answer every content-type rejection from this one table. */
const notLive = new EntityNotLiveError({ entityType: "content type", entityId: "recipe", state: "tombstoned" });
const cases: ReadonlyArray<[string, Error, { status: number; code: string }]> = [
  ["forbidden", new ForbiddenError({ message: "m" }), { status: 403, code: "FORBIDDEN" }],
  ["unknown type", new ContentTypeNotFoundError({ message: "m" }), { status: 404, code: "CONTENT_TYPE_NOT_FOUND" }],
  ["already exists", new ContentTypeAlreadyExistsError({ key: "recipe", tombstoned: false }), { status: 409, code: "CONTENT_TYPE_ALREADY_EXISTS" }],
  ["tombstoned type", notLive, { status: 409, code: notLive.code }],
  ["version conflict", new VersionConflictError({ message: "m" }), { status: 409, code: "VERSION_CONFLICT" }],
  ["refused transition", new ContentTypeLifecycleError({ message: "m" }), { status: 409, code: "CONTENT_TYPE_LIFECYCLE_ERROR" }],
  ["empty fields", new ValidationError({ message: "m", reason: "fields_empty" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["key grammar", new InvalidKeyGrammarError({ message: "m" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["reserved key", new ReservedContentTypeKeyError({ message: "m" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["field name grammar", new InvalidFieldNameGrammarError({ message: "m" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["field shape", new InvalidFieldShapeError({ path: "fields", expected: "an array", received: "a string" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["field kind", new InvalidFieldKindError({ message: "m" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["queryable cap", new QueryableFieldCapExceededError({ message: "m" }), { status: 400, code: "VALIDATION_ERROR" }],
  ["any other Error", new Error("repository unavailable"), { status: 500, code: "INTERNAL_ERROR" }],
];

for (const [name, error, expected] of cases) {
  test(`contentTypeWriteErrorStatus: ${name} maps to ${expected.status} ${expected.code}`, () => {
    assert.deepEqual(contentTypeWriteErrorStatus({ error }), expected);
  });
}
