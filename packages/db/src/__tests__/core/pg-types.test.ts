import assert from "node:assert/strict";
import { test } from "vitest";

import { parseInt8, PG_OID, PG_PARSERS } from "../../core/pg-types.js";

// F1.2/F4.3: Number(text) loses precision; <=/>= misclassifies the safe boundaries.
test("int8 preserves signed safe boundaries as numbers and larger integers as bigint", () => {
  for (const [text, expected] of [
    ["0", 0], ["-42", -42], ["1790000000123", 1790000000123],
    ["9007199254740991", 9007199254740991], ["-9007199254740991", -9007199254740991],
    ["9007199254740992", 9007199254740992n], ["-9007199254740992", -9007199254740992n],
    ["9223372036854775807", 9223372036854775807n], ["-9223372036854775808", -9223372036854775808n],
  ] as const) {
    assert.equal(parseInt8(text), expected);
    assert.equal(PG_PARSERS[20]!(text), expected);
  }
  assert.deepEqual(PG_OID, { int8: 20, json: 114, jsonb: 3802 });
});

// F4.4/F5.5: parseInt(text) would silently accept fractional and malformed input.
test("int8 rejects malformed integer text", () => {
  for (const text of ["1.5", "123tail", "not-an-integer"]) {
    assert.throws(() => parseInt8(text), SyntaxError);
    assert.throws(() => PG_PARSERS[20]!(text), SyntaxError);
  }
});

// F1.1/F2.6: JSON.parse alone returns an object; an identity parser keeps unwanted spacing.
for (const oid of [114, 3802]) {
  test(`OID ${oid} returns compact JSON text for objects and scalar values`, () => {
    assert.equal(PG_PARSERS[oid]!(' { "title": "café", "items": [1, true, null], "nested": { "x": 2 } } '),
      '{"title":"café","items":[1,true,null],"nested":{"x":2}}');
    assert.equal(PG_PARSERS[oid]!(' "hello\\nworld" '), '"hello\\nworld"');
    assert.equal(PG_PARSERS[oid]!(" null "), "null");
    assert.equal(PG_PARSERS[oid]!(" 17 "), "17");
  });

  test(`OID ${oid} propagates invalid JSON errors`, () => {
    assert.throws(() => PG_PARSERS[oid]!('{"missing":}'), SyntaxError);
  });
}
