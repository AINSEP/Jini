import assert from "node:assert/strict";
import { test } from "vitest";

import { EntityNotLiveError } from "../../../core/index.js";
import { entityNotLiveResponse } from "../entity-not-live.js";

/**
 * @file S4 (web-high fix plan, 2026-09-24) RED coverage for the HTTP half of the generic
 * entity-liveness guard. Every route this plan touches puts `entityNotLiveResponse` first in its
 * error ladder and relies on this exact 409 envelope shape.
 */

/** The identity host port: words the error with its own message. */
const passThrough = ({ error }: { error: Error }): string => error.message;

test("entityNotLiveResponse: an EntityNotLiveError maps to 409 with its code and message", () => {
  const err = new EntityNotLiveError({ entityType: "redirect", entityId: "r1", state: "trashed" });

  assert.deepEqual(entityNotLiveResponse({ err, outwardErrorMessage: passThrough }), {
    status: 409,
    body: {
      error: "ENTITY_IN_TRASH: redirect 'r1' is in the Trash. Restore it from the Trash before changing it.",
      code: "ENTITY_IN_TRASH",
    },
  });
});

test("entityNotLiveResponse: any other error is left unhandled (returns null)", () => {
  assert.equal(entityNotLiveResponse({ err: new Error("x"), outwardErrorMessage: passThrough }), null);
});


test("entityNotLiveResponse: a permanently deleted entity retains ENTITY_TOMBSTONED and its own message", () => {
  const err = new EntityNotLiveError({ entityType: "menu", entityId: "m2", state: "tombstoned" });
  assert.deepEqual(entityNotLiveResponse({ err, outwardErrorMessage: passThrough }), {
    status: 409,
    body: { error: "ENTITY_TOMBSTONED: menu 'm2' was permanently deleted and can't be changed.", code: "ENTITY_TOMBSTONED" },
  });
});

test("entityNotLiveResponse: the 409 body's error copy comes from the host's outwardErrorMessage port, not err.message", () => {
  const err = new EntityNotLiveError({ entityType: "page", entityId: "p1", state: "trashed" });
  const seen: Error[] = [];
  const outwardErrorMessage = ({ error }: { error: Error }): string => { seen.push(error); return "This item is in the Trash."; };
  assert.deepEqual(entityNotLiveResponse({ err, outwardErrorMessage }), {
    status: 409,
    body: { error: "This item is in the Trash.", code: "ENTITY_IN_TRASH" },
  });
  assert.deepEqual(seen, [err]);
});
