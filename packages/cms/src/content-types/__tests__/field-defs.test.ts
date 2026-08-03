import assert from "node:assert/strict";
import { test } from "vitest";

import { InvalidFieldKindError, InvalidFieldShapeError } from "../errors.js";
import { parseContentTypeFieldDefs } from "../field-defs.js";

/**
 * @file `field-defs.ts` — the shared untrusted-input boundary for a `fields` payload.
 *
 * The three cases this suite exists for are the gaps that motivated the module, each of which was
 * reachable from both the admin HTTP routes and the agent tools before it existed:
 *   - a non-boolean `required`/`queryable` was persisted verbatim (integrity gap);
 *   - a non-object element threw a bare `TypeError` inside the grammar guard (500 / opaque
 *     `'failed'` rather than a typed rejection);
 *   - a misspelled key was silently dropped.
 *
 * It deliberately also pins what this module does NOT judge, so a future editor does not "finish
 * the job" by moving the CIC U-002-B1 guard rules in here — see the module's own header.
 */

const VALID = { name: "servings", kind: "integer", required: false, queryable: true } as const;

function expectShapeViolation(value: unknown): InvalidFieldShapeError {
  const result = parseContentTypeFieldDefs(value);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof InvalidFieldShapeError, "expected an InvalidFieldShapeError");
  return (result as { ok: false; error: InvalidFieldShapeError }).error;
}

test("accepts a well-formed payload and returns the four verified keys, dropping nothing", () => {
  const result = parseContentTypeFieldDefs([VALID, { name: "title", kind: "text", required: true, queryable: false }]);

  assert.ok(result.ok);
  assert.deepEqual(result.ok && result.value, [
    { name: "servings", kind: "integer", required: false, queryable: true },
    { name: "title", kind: "text", required: true, queryable: false },
  ]);
});

test("accepts an empty array — a content type with no fields is legal", () => {
  const result = parseContentTypeFieldDefs([]);

  assert.ok(result.ok);
  assert.deepEqual(result.ok && result.value, []);
});

test("INTEGRITY GAP: a non-boolean 'queryable' is rejected — it used to count as queryable via truthiness and persist verbatim", () => {
  const error = expectShapeViolation([{ ...VALID, queryable: "yes" }]);

  assert.equal(error.violation.path, "fields[0].queryable");
  assert.equal(error.violation.expected, "a boolean");
  assert.equal(error.violation.received, "a string");
});

test("INTEGRITY GAP: a non-boolean 'required' is rejected — it used to be persisted verbatim into the record and its revision stateJson", () => {
  const error = expectShapeViolation([{ ...VALID, required: "maybe" }]);

  assert.equal(error.violation.path, "fields[0].required");
  assert.equal(error.violation.expected, "a boolean");
});

test("CRASH GAP: a null element returns a typed rejection instead of the TypeError the grammar guard used to throw on field.name", () => {
  const error = expectShapeViolation([null]);

  assert.equal(error.violation.path, "fields[0]");
  assert.equal(error.violation.expected, "an object");
  assert.equal(error.violation.received, "null");
});

test("CRASH GAP: an undefined element is rejected the same way (the other value that reached field.name and threw)", () => {
  assert.equal(expectShapeViolation([undefined]).violation.path, "fields[0]");
});

test("SILENT-DROP GAP: a misspelled key is reported rather than ignored, and the message lists the allowed keys", () => {
  const error = expectShapeViolation([{ name: "servings", kind: "integer", required: false, queryable: true, queryible: true }]);

  assert.equal(error.violation.path, "fields[0].queryible");
  assert.match(error.violation.expected, /name, kind, required, queryable/);
});

test("a missing key is reported at its own path, not as a whole-element failure", () => {
  assert.equal(expectShapeViolation([{ name: "servings", kind: "integer", required: false }]).violation.path, "fields[0].queryable");
  assert.equal(expectShapeViolation([{ kind: "integer", required: false, queryable: true }]).violation.path, "fields[0].name");
});

test("a non-array payload is rejected, and the error names the type received without echoing it", () => {
  assert.equal(expectShapeViolation({ name: "servings" }).violation.received, "an object");
  assert.equal(expectShapeViolation("servings").violation.received, "a string");
  assert.equal(expectShapeViolation(null).violation.received, "null");
  assert.equal(expectShapeViolation(undefined).violation.received, "an undefined");
});

test("an array element that is itself an array is rejected as a non-object, not treated as one", () => {
  assert.equal(expectShapeViolation([[VALID]]).violation.received, "an array");
});

test("the violation path identifies WHICH element failed, not just that one did", () => {
  const error = expectShapeViolation([VALID, VALID, { ...VALID, required: 1 }]);

  assert.equal(error.violation.path, "fields[2].required");
});

test("stops at the FIRST violation — a payload with two bad elements reports the earlier one only", () => {
  const error = expectShapeViolation([{ ...VALID, required: 1 }, { ...VALID, queryable: 1 }]);

  assert.equal(error.violation.path, "fields[0].required");
});

test("RESOURCE BOUND: a payload above the 500-entry cap is rejected before any per-element work", () => {
  const overCap = Array.from({ length: 501 }, (_, i) => ({ ...VALID, name: `f_${i}` }));
  const error = expectShapeViolation(overCap);

  assert.equal(error.violation.path, "fields");
  assert.match(error.violation.expected, /at most 500 entries/);
  // The cap is a resource bound, not a product rule — the boundary value itself must pass.
  assert.equal(parseContentTypeFieldDefs(overCap.slice(0, 500)).ok, true);
});

test("no error message ever echoes the offending VALUE — a fields payload can carry operator content", () => {
  const secret = "s3cret-operator-content";
  for (const payload of [[{ ...VALID, required: secret }], [{ ...VALID, name: 42, kind: secret }], secret]) {
    const result = parseContentTypeFieldDefs(payload);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.message.includes(secret), false, `message leaked the value: ${!result.ok ? result.error.message : ""}`);
  }
});

test("a 'kind' outside the closed enum raises the domain's own InvalidFieldKindError, not a shape error — both call sites already map it to 400", () => {
  const result = parseContentTypeFieldDefs([{ ...VALID, kind: "bogus" }]);

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof InvalidFieldKindError);
  assert.equal(!result.ok && result.error instanceof InvalidFieldShapeError, false, "kind-enum ownership stays with CIC U-002-B1 guard 4, so the error class must match guard 4's");
});

test("a non-string 'kind' is a shape violation, so the enum predicate never receives a non-string", () => {
  assert.equal(expectShapeViolation([{ ...VALID, kind: 7 }]).violation.path, "fields[0].kind");
});

test("does NOT judge field-name grammar — that stays CIC U-002-B1 guard 3, whose fixed order is pinned by AC-38", () => {
  const result = parseContentTypeFieldDefs([{ ...VALID, name: "NotValidGrammar!" }]);

  assert.equal(result.ok, true, "a grammar-invalid but structurally-valid name must pass this boundary and be rejected by guard 3 instead");
});

test("does NOT judge the queryable-field cap — that stays CIC U-002-B1 guard 5", () => {
  const allQueryable = Array.from({ length: 25 }, (_, i) => ({ ...VALID, name: `f_${i}`, queryable: true }));

  assert.equal(parseContentTypeFieldDefs(allQueryable).ok, true, "25 queryable fields exceeds QUERYABLE_FIELD_CAP (20) but is structurally valid — guard 5 owns that rejection");
});

test("KNOWN GAP, recorded deliberately: duplicate field names are structurally valid and pass — no guard rejects them today", () => {
  const result = parseContentTypeFieldDefs([VALID, VALID]);

  assert.equal(result.ok, true, "if a duplicate-name rule is ever added it belongs in the domain guard chain, not here — see this suite's header");
});
