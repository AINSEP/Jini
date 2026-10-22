import assert from "node:assert/strict";
import { test } from "vitest";

import { isHoneypotTripped } from "../forms.js";

test("isHoneypotTripped: true when _hp is a non-empty string", () => {
  assert.equal(isHoneypotTripped({ hp: "spam-bot-filled-this-in" }), true);
});

test("isHoneypotTripped: false when _hp is absent (undefined)", () => {
  assert.equal(isHoneypotTripped({ hp: undefined }), false);
});

test("isHoneypotTripped: false when _hp is an empty string", () => {
  assert.equal(isHoneypotTripped({ hp: "" }), false);
});

test("isHoneypotTripped: EC-09/behavior.spec.md §7 — false when _hp is whitespace-only", () => {
  assert.equal(isHoneypotTripped({ hp: "   " }), false);
});

test("isHoneypotTripped: true when _hp has leading/trailing whitespace around real content", () => {
  assert.equal(isHoneypotTripped({ hp: "  x  " }), true);
});

test("isHoneypotTripped: false when _hp is null", () => {
  assert.equal(isHoneypotTripped({ hp: null }), false);
});

test("isHoneypotTripped: non-string JSON values do not trip the string-only trap", () => {
  for (const hp of [123, ["x"], {}, true]) {
    assert.equal(isHoneypotTripped({ hp }), false, JSON.stringify(hp));
  }
});
