import assert from "node:assert/strict";
import { test } from "vitest";
import { clearFormSubmissionResultQueryParams, decodeFormSubmissionResultFromQuery, encodeFormSubmissionResultQuery, type FormResultQueryKeys } from "../result-query.js";
import type { FormSubmissionRedirectResult } from "../types.js";

const keys: FormResultQueryKeys = { slug: "form", status: "form_status", errors: "form_errors", retryAfter: "form_retry_after" };

test("clearFormSubmissionResultQueryParams removes all four form_* keys and keeps the page's own params", () => {
  const params = new URLSearchParams(
    "utm_source=mail&form=contact&form_status=validation&form_errors=%5B%5D&form_retry_after=30&page=2"
  );

  clearFormSubmissionResultQueryParams({ params: params, keys });

  assert.equal(params.toString(), "utm_source=mail&page=2");
});

test("encode: success writes exactly the slug and status, no errors or retry key", () => {
  assert.equal(encodeFormSubmissionResultQuery({ result: { kind: "success", slug: "contact" }, keys }).toString(), "form=contact&form_status=success");
});

test("encode: validation writes at most 20 field errors — the first 20, in order", () => {
  const fieldErrors = Array.from({ length: 25 }, (_, i) => ({ field: `f${i}`, reason: "Required" }));

  const params = encodeFormSubmissionResultQuery({ result: { kind: "validation", slug: "contact", fieldErrors }, keys });

  const written = JSON.parse(params.get("form_errors") ?? "null") as Array<{ field: string }>;
  assert.equal(written.length, 20);
  assert.equal(written[0]?.field, "f0");
  assert.equal(written[19]?.field, "f19");
  assert.equal(params.get("form_status"), "validation");
  assert.equal(params.has("form_retry_after"), false);
});

test("encode: rate-limited writes status 'rate_limited' and a whole, non-negative retry-after", () => {
  const fractional = encodeFormSubmissionResultQuery({ result: { kind: "rate-limited", slug: "contact", retryAfterSeconds: 12.9 }, keys });
  assert.equal(fractional.get("form_status"), "rate_limited");
  assert.equal(fractional.get("form_retry_after"), "12");
  assert.equal(fractional.has("form_errors"), false);

  const negative = encodeFormSubmissionResultQuery({ result: { kind: "rate-limited", slug: "contact", retryAfterSeconds: -5 }, keys });
  assert.equal(negative.get("form_retry_after"), "0");
});

test("decode: skips field errors without a non-empty string field and keeps valid errors", () => {
  const result = decodeFormSubmissionResultFromQuery({ query: {
    form: "contact",
    form_status: "validation",
    form_errors: JSON.stringify([
      null, [], true, { reason: "required" }, { field: "", reason: "required" },
      { field: 42, reason: "required" }, { field: "email", reason: "invalid" },
    ]),
  }, keys });

  assert.deepEqual(result, {
    kind: "validation", slug: "contact", fieldErrors: [{ field: "email", reason: "invalid" }],
  });
});

test("decode: rejects field-error JSON over 4000 characters even when it is valid JSON", () => {
  const errors = [{ field: "email", reason: "required" }];
  const query = { form: "contact", form_status: "validation" };
  const raw = JSON.stringify(errors).padEnd(4000, " ");

  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: { ...query, form_errors: raw }, keys }), {
    kind: "validation", slug: "contact", fieldErrors: errors,
  });
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: { ...query, form_errors: `${raw} ` }, keys }), {
    kind: "validation", slug: "contact", fieldErrors: [],
  });
});

test("decode: ignores a result without a non-empty string form slug", () => {
  for (const form of [undefined, "", 42, ["contact"]]) {
    assert.equal(decodeFormSubmissionResultFromQuery({ query: { form, form_status: "success" }, keys }), undefined);
  }
});

test("encodeFormSubmissionResultQuery + decodeFormSubmissionResultFromQuery round-trip every result kind", () => {
  const cases: FormSubmissionRedirectResult[] = [
    { kind: "success", slug: "contact" },
    { kind: "validation", slug: "contact", fieldErrors: [{ field: "email", reason: "Required" }] },
    { kind: "rate-limited", slug: "contact", retryAfterSeconds: 30 },
    { kind: "error", slug: "contact" },
  ];
  for (const result of cases) {
    const params = encodeFormSubmissionResultQuery({ result: result, keys });
    const query = Object.fromEntries(params.entries());
    assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: query, keys }), result);
  }
});

test("decodeFormSubmissionResultFromQuery: malformed/hostile query input degrades to undefined or an empty error list rather than throwing", () => {
  assert.equal(decodeFormSubmissionResultFromQuery({ query: {}, keys }), undefined);
  assert.equal(decodeFormSubmissionResultFromQuery({ query: { form: "contact" }, keys }), undefined, "status missing");
  assert.equal(decodeFormSubmissionResultFromQuery({ query: { form: "contact", form_status: "bogus" }, keys }), undefined);
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: { form: "contact", form_status: "validation", form_errors: "not json" }, keys }), {
    kind: "validation",
    slug: "contact",
    fieldErrors: [],
  });
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: { form: "contact", form_status: "validation", form_errors: '{"not":"an array"}' }, keys }), {
    kind: "validation",
    slug: "contact",
    fieldErrors: [],
  });
  // Oversized array is truncated, not rejected outright or allowed to grow unbounded.
  const manyErrors = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ field: `f${i}`, reason: "bad" })));
  const decoded = decodeFormSubmissionResultFromQuery({ query: { form: "contact", form_status: "validation", form_errors: manyErrors }, keys });
  assert.equal(decoded?.kind, "validation");
  assert.equal(decoded?.kind === "validation" ? decoded.fieldErrors.length : -1, 20);
});

test("encodeFormFlashCookieValue: never puts field values in the URL/query layer — the query round-trip functions are untouched by `values`", () => {
  // Regression guard for the explicit "do NOT put submitted values in the query string" requirement:
  // even a validation result that ALREADY carries `values` (as `mergeFormFlashIntoResult` would
  // attach) must not leak them through `encodeFormSubmissionResultQuery`.
  const result: FormSubmissionRedirectResult = {
    kind: "validation",
    slug: "contact",
    fieldErrors: [{ field: "message", reason: "Required" }],
    values: { name: "Ada Lovelace", email: "ada@example.com" },
  };
  const params = encodeFormSubmissionResultQuery({ result: result, keys });
  const serialized = params.toString();
  assert.doesNotMatch(serialized, /Ada/);
  assert.doesNotMatch(serialized, /example\.com/);
  assert.doesNotMatch(serialized, /values/);
});


test("timing retry round-trips without submitted text in the URL", () => {
  const params = encodeFormSubmissionResultQuery({ result: { kind: 'too-fast', slug: 'contact', values: { name: 'Ada' } }, keys });
  assert.equal(params.toString(), 'form=contact&form_status=too-fast');
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: Object.fromEntries(params), keys }), { kind: 'too-fast', slug: 'contact' });
});

test("decode bounds both field and reason strings without escaping machine data", () => {
  const field = 'f'.repeat(201);
  const reason = '<'.repeat(201);
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: {
    form: 'contact', form_status: 'validation', form_errors: JSON.stringify([{ field, reason }]),
  }, keys }), { kind: 'validation', slug: 'contact', fieldErrors: [{ field: field.slice(0, 200), reason: reason.slice(0, 200) }] });
});

test("host-supplied key names control encoding, decoding and clearing", () => {
  const keys: FormResultQueryKeys = { slug: 's', status: 'state', errors: 'issues', retryAfter: 'delay' };
  const result: FormSubmissionRedirectResult = { kind: 'rate-limited', slug: 'signup', retryAfterSeconds: 8 };
  const params = encodeFormSubmissionResultQuery({ result, keys });
  assert.equal(params.toString(), 's=signup&state=rate_limited&delay=8');
  assert.deepEqual(decodeFormSubmissionResultFromQuery({ query: Object.fromEntries(params), keys }), result);
  params.set('issues', '[]');
  params.set('keep', 'yes');
  clearFormSubmissionResultQueryParams({ params, keys });
  assert.equal(params.toString(), 'keep=yes');
});

test("decode admits error text at the exact payload ceiling but omits it above the ceiling", () => {
  const raw = '[{"field":"date","reason":"Choose an available date"}]';
  const read = (length: number) => decodeFormSubmissionResultFromQuery({ keys, query: {
    form: "contact", form_status: "validation", form_errors: raw.padEnd(length, " "),
  } });
  assert.deepEqual(read(4000), { kind: "validation", slug: "contact", fieldErrors: [{ field: "date", reason: "Choose an available date" }] });
  assert.deepEqual(read(4001), { kind: "validation", slug: "contact", fieldErrors: [] });
});

test("decode: a rate-limited retry-after that is not a whole positive number reads as 0", () => {
  const decode = (retry: unknown) => decodeFormSubmissionResultFromQuery({ query: { form: "contact", form_status: "rate_limited", form_retry_after: retry }, keys });
  for (const retry of ["0", "-3", "soon", "", undefined]) {
    assert.deepEqual(decode(retry), { kind: "rate-limited", slug: "contact", retryAfterSeconds: 0 }, String(retry));
  }
  assert.deepEqual(decode("1"), { kind: "rate-limited", slug: "contact", retryAfterSeconds: 1 });
  assert.deepEqual(decode("45s"), { kind: "rate-limited", slug: "contact", retryAfterSeconds: 45 });
});
