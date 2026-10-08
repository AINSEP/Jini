import assert from "node:assert/strict";
import { test } from "vitest";
import { scanEmbedMarkers, withInnerContent } from "../markers/marker.js";
import { buildWidgetInstanceFieldsJson, parseWidgetInstancePayload, buildWidgetAreaFieldsJson, parseWidgetAreaPayload } from "../entry-payload.js";

// Literal element: Tovu content/themes/static/tailark-dusk/index.html:54.
const MARKER = `<nav class="main-nav" data-embed-config='{"type":"menu","id":"menu-header-nav"}'><!-- live content when connected to Tovu --></nav>`;

// Frozen bytes of the checked-in widget payload literal passed to fields_json:
// Tovu apps/website/src/features/widgets/__tests__/integration/embed-service.integration.test.ts:575.
const INSTANCE_FIELDS = '{"ext":{"widget":{"payload":"{\\"widgetType\\":\\"text\\",\\"config\\":{\\"body\\":\\"hello\\"},\\"status\\":\\"active\\"}"}}}';
// Frozen bytes of the checked-in area fieldsJson literal:
// Tovu apps/website/src/features/widgets/__tests__/integration/resolver-service.integration.test.ts:280.
const AREA_FIELDS = '{"ext":{"widgets":{"payload":"{\\"regionKey\\":\\"footer\\",\\"doc\\":{\\"schemaVersion\\":1,\\"placements\\":[{\\"placementId\\":\\"p1\\",\\"widgetEntryId\\":\\"corrupted-widget\\",\\"enabled\\":true}]}}"}}}';

test("checked-in marker and widget/area stored bytes survive parse and serialization", () => {
  const { markers, rejected } = scanEmbedMarkers({ html: MARKER });
  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1);
  assert.ok(markers[0]);
  assert.equal(withInnerContent({ marker: markers[0], inner: markers[0].inner }), MARKER);
  const instance = parseWidgetInstancePayload({ fieldsJson: JSON.parse(INSTANCE_FIELDS) });
  assert.equal(JSON.stringify(buildWidgetInstanceFieldsJson({ payload: instance })), INSTANCE_FIELDS);
  const area = parseWidgetAreaPayload({ fieldsJson: JSON.parse(AREA_FIELDS) });
  assert.equal(JSON.stringify(buildWidgetAreaFieldsJson({ payload: area })), AREA_FIELDS);
});
