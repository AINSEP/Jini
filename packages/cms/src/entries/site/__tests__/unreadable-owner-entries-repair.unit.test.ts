import assert from "node:assert/strict";
import { test } from "vitest";

import { isMismatchedOwnerEnvelope } from "../unreadable-owner-entries-repair.js";

/**
 * @file The boot repair's predicate on its own: a row is removable only when its envelope has a
 * namespace and NONE of them is the owner's. Everything else (a readable row, a row with both, a
 * malformed or missing envelope) is out of scope and stays.
 */

const owner = "widget";

test("a payload under another namespace only is mismatched (the 2026-08-03 probe rows)", () => {
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { site: { payload: "probe" } } }, owner }), true);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { site: "scalar", other: {} } }, owner }), true);
});

test("any envelope that carries the owner's key is never mismatched, readable or not", () => {
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: { payload: "{}" } } }, owner }), false);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: { payload: "{}" }, site: { payload: "x" } } }, owner }), false);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: null, site: {} } }, owner }), false);
});

test("a missing or non-object envelope, or an empty ext, is not this defect", () => {
  for (const fieldsJson of [null, "text", 3, [], {}, { ext: null }, { ext: [] }, { ext: "site" }, { ext: {} }, { payload: "x" }]) {
    assert.equal(isMismatchedOwnerEnvelope({ fieldsJson, owner }), false, JSON.stringify(fieldsJson));
  }
});

test("an inherited key is not an own namespace", () => {
  const ext = Object.create({ site: {} }) as Record<string, unknown>;
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext }, owner }), false);
});
