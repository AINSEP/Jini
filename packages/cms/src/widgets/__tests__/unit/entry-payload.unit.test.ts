import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildWidgetAreaFieldsJson,
  buildWidgetInstanceFieldsJson,
  parseWidgetAreaPayload,
  parseWidgetInstancePayload,
} from "../../index.js";

/**
 * @file The `fieldsJson.ext.<owner>.payload` envelope a widget instance / `widget_area` entry is
 * stored in — round trip and every malformed-envelope refusal, through the `widgets` public barrel.
 * A malformed row must fail loudly with a message naming what is missing, never parse as empty.
 */

test("a widget instance payload round-trips through its own ext.widget envelope", () => {
  const payload = { widgetType: "text" as const, config: { body: "hi" }, status: "active" as const };
  const fieldsJson = buildWidgetInstanceFieldsJson({ payload });

  assert.deepEqual(fieldsJson, { ext: { widget: { payload: JSON.stringify(payload) } } });
  assert.deepEqual(parseWidgetInstancePayload({ fieldsJson }), payload);
});

test("a widget_area payload is stored under ext.widgets and is not readable as a widget instance", () => {
  const payload = { regionKey: "sidebar", doc: { schemaVersion: 1 as const, placements: [] } };
  const fieldsJson = buildWidgetAreaFieldsJson({ payload });

  assert.deepEqual(parseWidgetAreaPayload({ fieldsJson }), payload);
  assert.throws(() => parseWidgetInstancePayload({ fieldsJson }), /missing fields\.ext\.widget\.payload/);
});

test("a fieldsJson that is not a plain object is refused as malformed", () => {
  for (const fieldsJson of [null, "payload", 42, ["ext"]]) {
    assert.throws(() => parseWidgetInstancePayload({ fieldsJson }), { message: "widgets: malformed fieldsJson (expected an object)" });
  }
});

test("a fieldsJson object without an ext bag is refused as malformed", () => {
  for (const fieldsJson of [{}, { ext: "nope" }, { ext: [] }]) {
    assert.throws(() => parseWidgetAreaPayload({ fieldsJson }), { message: "widgets: malformed fieldsJson (missing ext)" });
  }
});

test("an ext bag whose owner payload is missing or not a string is refused, naming the owner", () => {
  for (const fieldsJson of [{ ext: {} }, { ext: { widgets: [] } }, { ext: { widgets: { payload: 1 } } }]) {
    assert.throws(() => parseWidgetAreaPayload({ fieldsJson }), { message: "widgets: malformed fieldsJson (missing fields.ext.widgets.payload)" });
  }
});
