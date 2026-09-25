import assert from "node:assert/strict";
import { test } from "vitest";

import { validateFieldsAgainstSchema } from "../field-validation.js";

/**
 * @file The `json` and `relation` conformance arms.
 *
 * The `json` arm exists to answer one specific failure: a validator for a storage-only kind that
 * returns unconditional `true` accepts every value that `JSON.stringify` then throws on or
 * silently mangles — moving the failure downstream of the only component whose job was to catch
 * it. Each rejection below is paired with what `JSON.stringify` would actually have done, because
 * "this is not a JSON value" is only a real finding if something downstream would have broken.
 */

function check(kind: string, value: unknown) {
  return validateFieldsAgainstSchema({
    schema: [{ name: "f", kind: kind as never, required: false, queryable: false }],
    fieldsJson: { ext: { site: { f: value } } },
  });
}

const ACCEPTED: ReadonlyArray<[string, unknown]> = [
  ["null", null],
  ["boolean", true],
  ["string", "abc"],
  ["empty string", ""],
  ["integer", 7],
  ["float", 1.5],
  ["negative zero", -0],
  ["empty array", []],
  ["string array (the acceptance test's own shape)", ["flour", "water"]],
  ["empty object", {}],
  ["flat object", { a: 1, b: "two", c: false, d: null }],
  ["nested mix", { a: [{ b: [1, 2, { c: "d" }] }] }],
  ["null-prototype object", Object.assign(Object.create(null) as object, { a: 1 })],
];

for (const [label, value] of ACCEPTED) {
  test(`json accepts a JSON value: ${label}`, () => {
    assert.equal(check("json", value).valid, true, `${label} round-trips through JSON.stringify unchanged and must be accepted`);
  });
}

const REJECTED: ReadonlyArray<[string, unknown, string]> = [
  ["undefined", undefined, "JSON.stringify drops the key entirely"],
  ["function", () => 1, "JSON.stringify drops the key entirely"],
  ["symbol", Symbol("s"), "JSON.stringify drops the key entirely"],
  ["bigint", BigInt(1), "JSON.stringify THROWS a TypeError"],
  ["NaN", NaN, "JSON.stringify rewrites it to null — reads back as a different type"],
  ["Infinity", Infinity, "JSON.stringify rewrites it to null"],
  ["-Infinity", -Infinity, "JSON.stringify rewrites it to null"],
  ["Map", new Map([["a", 1]]), "JSON.stringify emits {} — every entry silently lost"],
  ["Set", new Set([1, 2]), "JSON.stringify emits {} — every element silently lost"],
  ["Date", new Date(0), "JSON.stringify emits a string — the value's type changes at rest"],
  ["class instance", new (class Thing { constructor(public a = 1) {} })(), "not a plain JSON object; its prototype is lost"],
  ["nested undefined", { a: { b: undefined } }, "the nested key is dropped"],
  ["array containing a function", [1, () => 1], "the element becomes null"],
  ["array containing undefined", [1, undefined], "the element becomes null"],
  ["nested NaN", { a: [{ b: NaN }] }, "rewritten to null at depth"],
];

for (const [label, value, why] of REJECTED) {
  test(`json rejects a non-JSON value: ${label} (${why})`, () => {
    const result = check("json", value);
    assert.equal(result.valid, false, `${label} must be rejected here rather than at the storage boundary`);
    assert.deepEqual(result.fieldErrors, [{ field: "f", reason: "value does not conform to the declared kind 'json'" }]);
  });
}

test("json rejects a symbol-keyed property rather than silently dropping it", () => {
  const value: Record<string, unknown> = { a: 1 };
  (value as Record<symbol, unknown>)[Symbol("hidden")] = 2;
  assert.equal(check("json", value).valid, false, "JSON.stringify discards symbol keys; accepting one persists a value the caller was never told was thrown away");
});

test("json TERMINATES on a self-referential value instead of hanging or overflowing the stack", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(check("json", cyclic).valid, false, "JSON.stringify throws on a circular structure; the depth bound is what makes this check total");
});

test("json TERMINATES on a mutually-referential pair", () => {
  const a: Record<string, unknown> = {};
  const b: Record<string, unknown> = { a };
  a.b = b;
  assert.equal(check("json", a).valid, false);
});

test("json enforces a depth bound: 32 levels is accepted, 40 is rejected", () => {
  const nest = (depth: number) => {
    let value: unknown = 1;
    for (let i = 0; i < depth; i += 1) value = { a: value };
    return value;
  };
  assert.equal(check("json", nest(30)).valid, true);
  assert.equal(check("json", nest(40)).valid, false, "an unbounded recursive check is a stack-overflow surface on caller-supplied input");
});

test("json enforces a node bound so a wide-but-shallow payload cannot make validation the expensive part of a write", () => {
  assert.equal(check("json", Array.from({ length: 5_000 }, (_, i) => i)).valid, true);
  assert.equal(check("json", Array.from({ length: 20_000 }, (_, i) => i)).valid, false);
});

test("relation accepts a string id and nothing else — it is shape-checked exactly like text", () => {
  assert.equal(check("relation", "author-1").valid, true);
  assert.equal(check("relation", "").valid, true);
  for (const value of [7, true, null, undefined, {}, [], new Date(0)]) {
    assert.equal(check("relation", value).valid, false, `relation must reject ${String(value)}`);
  }
});

test("relation does NOT check referential integrity — an id pointing at nothing is accepted, and that gap is the application layer's", () => {
  assert.equal(check("relation", "definitely-not-a-real-author-id").valid, true);
});

test("a required json field is still subject to the required-field rule, and its absence is reported as missing rather than as non-conforming", () => {
  const result = validateFieldsAgainstSchema({
    schema: [{ name: "f", kind: "json" as never, required: true, queryable: false }],
    fieldsJson: { ext: { site: {} } },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.fieldErrors, [{ field: "f", reason: "required field is missing" }]);
});
