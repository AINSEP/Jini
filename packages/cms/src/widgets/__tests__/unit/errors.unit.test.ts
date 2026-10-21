import assert from "node:assert/strict";
import { test } from "vitest";

import * as widgets from "../../index.js";

/**
 * @file Every typed `widgets` domain error, through the public barrel: the class carries its own
 * `name` (so `/ClassName/` matches `String(error)`, see `errors.ts`'s header), its message, and the
 * structured fields route handlers map to HTTP bodies — including the defaults for optional lists.
 */

test("each error class sets its own name and message and is an Error", () => {
  const cases: Array<[Error, string]> = [
    [new widgets.WidgetTypeUnregisteredError({ message: "m", widgetType: "x" }), "WidgetTypeUnregisteredError"],
    [new widgets.WidgetConfigValidationError({ message: "m" }), "WidgetConfigValidationError"],
    [new widgets.WidgetVersionConflictError({ message: "m", currentVersion: 1 }), "WidgetVersionConflictError"],
    [new widgets.WidgetAreaConflictError({ message: "m", currentVersion: 1 }), "WidgetAreaConflictError"],
    [new widgets.WidgetReferencedError({ message: "m" }), "WidgetReferencedError"],
    [new widgets.WidgetEmbedGuardrailError({ message: "m", reason: "recursion" }), "WidgetEmbedGuardrailError"],
    [new widgets.WidgetInstanceNotFoundError({ message: "m" }), "WidgetInstanceNotFoundError"],
    [new widgets.WidgetAreaNotFoundError({ message: "m" }), "WidgetAreaNotFoundError"],
    [new widgets.WidgetForbiddenError({ message: "m" }), "WidgetForbiddenError"],
    [new widgets.WidgetEmbedHostNotFoundError({ message: "m" }), "WidgetEmbedHostNotFoundError"],
    [new widgets.WidgetEmbedPlacementNotFoundError({ message: "m" }), "WidgetEmbedPlacementNotFoundError"],
    [new widgets.WidgetEmbedHostUnsupportedError({ message: "m", reason: "html-page" }), "WidgetEmbedHostUnsupportedError"],
  ];
  for (const [error, name] of cases) {
    assert.ok(error instanceof Error, name);
    assert.equal(error.name, name);
    assert.equal(error.message, "m");
    assert.equal(String(error), `${name}: m`);
  }
});

test("WidgetReferencedError carries the referencing locations, defaulting to none", () => {
  const locations = [{ kind: "region" as const, entryId: "area-1" }, { kind: "embed" as const, entryId: "post-1" }];
  assert.deepEqual(new widgets.WidgetReferencedError({ message: "in use", referencingLocations: locations }).referencingLocations, locations);
  assert.deepEqual(new widgets.WidgetReferencedError({ message: "in use" }).referencingLocations, []);
});

test("structured fields survive construction for the typed 4xx mappings", () => {
  assert.equal(new widgets.WidgetTypeUnregisteredError({ message: "m", widgetType: "carousel" }).widgetType, "carousel");
  assert.deepEqual(new widgets.WidgetConfigValidationError({ message: "m" }).fieldErrors, []);
  assert.deepEqual(
    new widgets.WidgetConfigValidationError({ message: "m", fieldErrors: [{ field: "title", reason: "required" }] }).fieldErrors,
    [{ field: "title", reason: "required" }],
  );
  assert.equal(new widgets.WidgetVersionConflictError({ message: "m", currentVersion: 4 }).currentVersion, 4);
  assert.equal(new widgets.WidgetAreaConflictError({ message: "m", currentVersion: 7 }).currentVersion, 7);
  assert.equal(new widgets.WidgetEmbedGuardrailError({ message: "m", reason: "count-exceeded" }).reason, "count-exceeded");
  assert.equal(new widgets.WidgetEmbedHostUnsupportedError({ message: "m", reason: "widget-area" }).reason, "widget-area");
});
