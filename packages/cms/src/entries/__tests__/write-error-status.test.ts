import assert from 'node:assert/strict';
import { test } from "vitest";
import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  EntryNotFoundError,
  EntrySlugConflictError,
  ForbiddenError,
  VersionConflictError,
} from "../errors.js";
import { entryWriteErrorStatus } from "../write-error-status.js";

/** The create, update and lifecycle routes answer every write-service error kind from this one table. */
const cases: ReadonlyArray<[string, Error, { status: number; code: string }]> = [
  ['forbidden', new ForbiddenError({ message: 'm' }), { status: 403, code: 'FORBIDDEN' }],
  ['unknown content type', new ContentTypeNotFoundError({ message: 'm' }), { status: 404, code: 'CONTENT_TYPE_NOT_FOUND' }],
  ['unknown entry', new EntryNotFoundError({ message: 'm' }), { status: 404, code: 'ENTRY_NOT_FOUND' }],
  ['inactive content type', new ContentTypeNotActiveError({ message: 'm' }), { status: 409, code: 'CONTENT_TYPE_NOT_ACTIVE' }],
  ['slug conflict', new EntrySlugConflictError({ message: 'm' }), { status: 409, code: 'ENTRY_SLUG_CONFLICT' }],
  ['version conflict', new VersionConflictError({ message: 'm' }), { status: 409, code: 'VERSION_CONFLICT' }],
  ['invalid fields', new EntryFieldValidationError({ fieldErrors: [{ field: 'rating', reason: 'must be a number' }] }), { status: 400, code: 'VALIDATION_ERROR' }],
  ['any other Error', new Error('repository unavailable'), { status: 500, code: 'INTERNAL_ERROR' }],
];

for (const [name, error, expected] of cases) {
  test(`entryWriteErrorStatus: ${name} maps to ${expected.status} ${expected.code}`, () => {
    assert.deepEqual(entryWriteErrorStatus({ error }), expected);
  });
}
