import { expect, test } from "vitest";
import type { JsonValue } from "@jini-ai/core/primitives";
import { renderDocWithManagedMarkers } from "../document-markers.js";

const render = (bodyJson: unknown, maxDepth = 5) => renderDocWithManagedMarkers({ bodyJson, token: "TOKEN", maxDepth, renderDocNode: ({ node }) => JSON.stringify(node) });
test("substitutes managed nodes in order and leaves invalid and legacy images unchanged", () => {
  const output = render({ type: "doc", content: [{ type: "widgetEmbed", attrs: { widgetEntryId: "a'b", content: "$&", cssClass: "first", htmlAttributes: 'class="second"' } }, { type: "media", attrs: { assetId: "id", alt: "A & B" } }, { type: "image", attrs: { assetId: "bad/id" } }, { type: "image", attrs: { src: "/legacy" } }] });
  expect(output).toContain("first second");
  expect(output).toContain("a\\u0027b");
  expect(output).toContain("$&");
  expect(output).toContain('alt="A &amp; B"');
  expect(output.indexOf('"type":"widget"')).toBeLessThan(output.indexOf('"type":"media"'));
  expect(output).toContain('bad/id');
  expect(output).toContain('/legacy');
});
test("substitutes at the depth boundary but leaves deeper nodes intact", () => {
  const node: JsonValue = { type: "doc", content: [{ type: "media", attrs: { assetId: "one" }, content: [{ type: "media", attrs: { assetId: "two" } }] }] };
  expect(render(node, 1)).toContain('"id":"one"');
  expect(render(node, 0)).toContain('"assetId":"one"');
});
