import assert from "node:assert/strict";
import { test } from "vitest";
import { decodeFormFlashCookieValue, encodeFormFlashCookieValue, mergeFormFlashIntoResult, type FormFlashPayload } from "../result-flash.js";
import type { FormSubmissionRedirectResult } from "../types.js";

test("decode flash: JSON null is ignored without throwing", () => {
  assert.equal(decodeFormFlashCookieValue({ raw: "null" }), undefined);
});

test("decode flash: rejects a missing, empty or non-string slug even with valid values", () => {
  for (const slug of [undefined, "", 42]) {
    assert.equal(decodeFormFlashCookieValue({ raw: JSON.stringify({ slug, values: { email: "ada@example.com" } }) }), undefined);
  }
});

test("encode flash: a payload with no values sets no cookie", () => {
  assert.equal(encodeFormFlashCookieValue({ payload: { slug: "s", values: {} } }), undefined);
});

test("encode flash: a slug too long for the cookie on its own sets no cookie", () => {
  assert.equal(encodeFormFlashCookieValue({ payload: { slug: "s".repeat(3001), values: { name: "Ada" } } }), undefined);
});

test("encodeFormFlashCookieValue + decodeFormFlashCookieValue round-trip a small payload", () => {
  const payload: FormFlashPayload = { slug: "contact", values: { name: "Ada Lovelace", email: "ada@example.com" } };
  const json = encodeFormFlashCookieValue({ payload: payload });
  assert.ok(json, "small payload must fit and encode to a real string");
  assert.deepEqual(decodeFormFlashCookieValue({ raw: json }), payload);
});

test("encodeFormFlashCookieValue: a value longer than the per-field bound is truncated, not rejected", () => {
  const longValue = "begin:" + "x".repeat(294) + "end:" + "y".repeat(4696); // MAX_BODY_STRING_LENGTH's own bound in forms-submit.ts
  const json = encodeFormFlashCookieValue({ payload: { slug: "contact", values: { message: longValue } } });
  assert.ok(json);
  const decoded = decodeFormFlashCookieValue({ raw: json });
  assert.equal(decoded?.values.message.length, 300);
  assert.equal(decoded?.values.message, "begin:" + "x".repeat(294));
  assert.ok(longValue.startsWith(decoded!.values.message), "the truncated preview must be a real prefix of what was typed");
});

test("encodeFormFlashCookieValue: a form with many long fields that would not fit in one cookie drops LATER fields, keeping earlier ones, rather than emitting an oversized/broken cookie", () => {
  const fields = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, "y".repeat(300)]));
  const json = encodeFormFlashCookieValue({ payload: { slug: "contact", values: fields } });
  assert.ok(json, "must still encode SOMETHING — dropping fields, not giving up entirely");
  assert.ok(Buffer.byteLength(json, "utf8") <= 3000, "encoded cookie value must respect the byte budget");
  const decoded = decodeFormFlashCookieValue({ raw: json })!;
  const keptCount = Object.keys(decoded.values).length;
  assert.ok(keptCount > 0 && keptCount < 20, `expected some but not all fields to survive, got ${keptCount}`);
  assert.ok("field0" in decoded.values, "the FIRST-declared field must survive the drop");
  assert.ok(!("field19" in decoded.values), "the LAST-declared field must be the one dropped");
});

test("decodeFormFlashCookieValue: malformed/hostile cookie input degrades to undefined rather than throwing", () => {
  assert.equal(decodeFormFlashCookieValue({ raw: undefined }), undefined);
  assert.equal(decodeFormFlashCookieValue({ raw: "" }), undefined);
  assert.equal(decodeFormFlashCookieValue({ raw: "not json" }), undefined);
  assert.equal(decodeFormFlashCookieValue({ raw: '{"slug":""}' }), undefined, "empty slug is not a usable flash");
  assert.equal(decodeFormFlashCookieValue({ raw: '{"slug":"contact"}' }), undefined, "missing values object");
  assert.equal(decodeFormFlashCookieValue({ raw: '{"slug":"contact","values":"not an object"}' }), undefined);
  assert.deepEqual(decodeFormFlashCookieValue({ raw: '{"slug":"contact","values":{"a":"ok","b":123}}' }), {
    slug: "contact",
    values: { a: "ok" },
  });
});

test("mergeFormFlashIntoResult: attaches values only to a validation result for the SAME slug", () => {
  const validation: FormSubmissionRedirectResult = { kind: "validation", slug: "contact", fieldErrors: [] };
  assert.deepEqual(mergeFormFlashIntoResult({ result: validation, flash: { slug: "contact", values: { name: "Ada" } } }), {
    ...validation,
    values: { name: "Ada" },
  });
  assert.equal(mergeFormFlashIntoResult({ result: validation, flash: { slug: "newsletter", values: { name: "Ada" } } }), validation, "different slug: unchanged");
  assert.equal(mergeFormFlashIntoResult({ result: validation, flash: undefined }), validation, "no flash: unchanged");
  assert.equal(mergeFormFlashIntoResult({ result: undefined, flash: { slug: "contact", values: { name: "Ada" } } }), undefined, "no result: unchanged");
  const success: FormSubmissionRedirectResult = { kind: "success", slug: "contact" };
  assert.equal(mergeFormFlashIntoResult({ result: success, flash: { slug: "contact", values: { name: "Ada" } } }), success, "non-validation kind: unchanged");
});


test("flash budget counts UTF-8 bytes and drops only later fields", () => {
  const value = '界'.repeat(300);
  const payload = { slug: 'contact', values: { first: value, second: value, third: value, fourth: value } };
  const json = encodeFormFlashCookieValue({ payload });
  assert.equal(json, JSON.stringify({ slug: 'contact', values: { first: value, second: value, third: value } }));
  assert.ok(json);
  assert.ok(Buffer.byteLength(json, 'utf8') <= 3000);
  assert.deepEqual(decodeFormFlashCookieValue({ raw: json }), { slug: 'contact', values: { first: value, second: value, third: value } });
});

test("flash decode bounds slug, field count, field ids and string values", () => {
  const longField = 'f'.repeat(101);
  const values = Object.fromEntries([[longField, 'v'.repeat(301)], ...Array.from({ length: 20 }, (_, i) => [`f${i}`, 'ok'])]);
  const decoded = decodeFormFlashCookieValue({ raw: JSON.stringify({ slug: 's'.repeat(201), values }) });
  assert.deepEqual(decoded, {
    slug: 's'.repeat(200),
    values: Object.fromEntries([[longField.slice(0, 100), 'v'.repeat(300)], ...Array.from({ length: 19 }, (_, i) => [`f${i}`, 'ok'])]),
  });
});

test("timing retry merges matching flash only; other result kinds keep their identity", () => {
  const result: FormSubmissionRedirectResult = { kind: 'too-fast', slug: 'contact' };
  const flash = { slug: 'contact', values: { name: 'Ada' } };
  assert.deepEqual(mergeFormFlashIntoResult({ result, flash }), { ...result, values: flash.values });
  assert.equal(mergeFormFlashIntoResult({ result, flash: { ...flash, slug: 'other' } }), result);
  for (const result of [
    { kind: 'rate-limited', slug: 'contact', retryAfterSeconds: 3 },
    { kind: 'error', slug: 'contact' },
  ] satisfies FormSubmissionRedirectResult[]) {
    assert.equal(mergeFormFlashIntoResult({ result, flash }), result);
  }
});
