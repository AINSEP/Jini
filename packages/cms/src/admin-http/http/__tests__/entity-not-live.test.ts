import assert from "node:assert/strict";
import { test } from "vitest";

import { EntityNotLiveError } from "../../../core/index.js";
import { entityNotLiveResponse } from "../entity-not-live.js";

/**
 * @file S4 (web-high fix plan, 2026-09-24) RED coverage for the HTTP half of the generic
 * entity-liveness guard. Every route this plan touches puts `entityNotLiveResponse` first in its
 * error ladder and relies on this exact 409 envelope shape.
 */

test("entityNotLiveResponse: an EntityNotLiveError maps to 409 with its code and message", () => {
  const err = new EntityNotLiveError({ entityType: "redirect", entityId: "r1", state: "trashed" });

  assert.deepEqual(entityNotLiveResponse({ err }), {
    status: 409,
    body: {
      error: "ENTITY_IN_TRASH: redirect 'r1' is in the Trash. Restore it from the Trash before changing it.",
      code: "ENTITY_IN_TRASH",
    },
  });
});

test("entityNotLiveResponse: any other error is left unhandled (returns null)", () => {
  assert.equal(entityNotLiveResponse({ err: new Error("x") }), null);
});


test("entityNotLiveResponse: a permanently deleted entity retains ENTITY_TOMBSTONED and its own message", () => {
  const err = new EntityNotLiveError({ entityType: "menu", entityId: "m2", state: "tombstoned" });
  assert.deepEqual(entityNotLiveResponse({ err }), {
    status: 409,
    body: { error: "ENTITY_TOMBSTONED: menu 'm2' was permanently deleted and can't be changed.", code: "ENTITY_TOMBSTONED" },
  });
});
