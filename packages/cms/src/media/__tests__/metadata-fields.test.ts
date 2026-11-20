import assert from "node:assert/strict";
import { test } from "vitest";

import { MediaValidationError } from "../types.js";
import { parseOptionalSlugField, parseOptionalStringField, parseOptionalTitleField } from "../metadata-fields.js";

/**
 * @file Direct tests for `parse.ts`'s three field parsers. The `slug` null/wrong-type
 * rejections and `title`'s wrong-type rejection had no test at all.
 */

function rejectsWith(fn: () => unknown, message: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof MediaValidationError, `expected MediaValidationError, got ${String(err)}`);
    assert.equal(err.message, message);
    return true;
  });
}

test("parseOptionalStringField: undefined stays omitted, null clears to '', a string passes through untouched", () => {
  assert.equal(parseOptionalStringField({ raw: undefined, field: "alt" }), undefined);
  assert.equal(parseOptionalStringField({ raw: null, field: "alt" }), "");
  assert.equal(parseOptionalStringField({ raw: "  A cabin  ", field: "alt" }), "  A cabin  ");
  assert.equal(parseOptionalStringField({ raw: "", field: "alt" }), "");
});

test("parseOptionalStringField: a non-string is rejected naming the field and its real shape (array, not object)", () => {
  rejectsWith(() => parseOptionalStringField({ raw: 42, field: "credit" }), "media.credit must be a string or null, got number");
  rejectsWith(() => parseOptionalStringField({ raw: ["a"], field: "credit" }), "media.credit must be a string or null, got array");
  rejectsWith(() => parseOptionalStringField({ raw: { a: 1 }, field: "credit" }), "media.credit must be a string or null, got object");
});

test("parseOptionalTitleField: undefined stays omitted and a string passes through; null and non-strings are rejected", () => {
  assert.equal(parseOptionalTitleField({ raw: undefined }), undefined);
  assert.equal(parseOptionalTitleField({ raw: "Hero" }), "Hero");
  rejectsWith(() => parseOptionalTitleField({ raw: null }), "media.title cannot be cleared to null; title is required and cannot be empty");
  rejectsWith(() => parseOptionalTitleField({ raw: 7 }), "media.title must be a string, got number");
  rejectsWith(() => parseOptionalTitleField({ raw: ["Hero"] }), "media.title must be a string, got array");
});

test("parseOptionalSlugField: undefined stays omitted and a string passes through unnormalized; null and non-strings are rejected", () => {
  assert.equal(parseOptionalSlugField({ raw: undefined }), undefined);
  assert.equal(parseOptionalSlugField({ raw: "Woodnest-Cabin" }), "Woodnest-Cabin", "normalization belongs to the service, not this parser");
  rejectsWith(() => parseOptionalSlugField({ raw: null }), "media.slug cannot be cleared to null; slug is required and cannot be empty");
  rejectsWith(() => parseOptionalSlugField({ raw: false }), "media.slug must be a string, got boolean");
  rejectsWith(() => parseOptionalSlugField({ raw: ["a"] }), "media.slug must be a string, got array");
});
