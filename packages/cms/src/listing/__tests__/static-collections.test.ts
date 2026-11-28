import assert from "node:assert/strict";
import { test } from "vitest";
import { collectionMarkerKey, splitCollectionMarkerInner, injectCollectionEmbeds } from "../static-collections.js";
import { markersOfType, COLLECTION_MARKER_TYPE, MENU_MARKER_TYPE } from "../../widgets/markers/marker.js";

test("splitCollectionMarkerInner: no <template> -> whole inner content is the fallback, no template returned", () => {
  const result = splitCollectionMarkerInner({ inner: "<p>empty state</p>" });
  assert.equal(result.template, undefined);
  assert.equal(result.fallback, "<p>empty state</p>");
});

test("splitCollectionMarkerInner: a <template> block is pulled out, remaining markup becomes the fallback", () => {
  const result = splitCollectionMarkerInner({ inner: '<template><h3>{{title}}</h3></template><p>empty state</p>' });
  assert.equal(result.template, "<h3>{{title}}</h3>");
  assert.equal(result.fallback, "<p>empty state</p>");
});

test("splitCollectionMarkerInner: only the FIRST <template> block is extracted", () => {
  const result = splitCollectionMarkerInner({ inner: "<template>one</template><template>two</template>" });
  assert.equal(result.template, "one");
  assert.equal(result.fallback, "<template>two</template>");
});

test("splitCollectionMarkerInner: an unterminated <template> is treated as no template at all", () => {
  const result = splitCollectionMarkerInner({ inner: "<template>never closed" });
  assert.equal(result.template, undefined);
  assert.equal(result.fallback, "<template>never closed");
});

test("collectionMarkerKey: two markers with the SAME config but different <template>s get different keys", () => {
  const config = '{"type":"collection","typeKey":"recipe"}';
  const html =
    `<div data-embed-config='${config}'><template><b>{{title}}</b></template>none</div>` +
    `<div data-embed-config='${config}'><template><i>{{title}}</i></template>none</div>`;
  const [bold, italic] = markersOfType({ html: html, type: COLLECTION_MARKER_TYPE });
  assert.ok(bold !== undefined && italic !== undefined);
  assert.notEqual(collectionMarkerKey(bold), collectionMarkerKey(italic));
});

test("collectionMarkerKey: a template-less marker keeps its plain config-JSON key; the same config with a template does not share it", () => {
  const config = '{"type":"collection","typeKey":"recipe"}';
  const html =
    `<div data-embed-config='${config}'>none</div>` + `<div data-embed-config='${config}'><template>{{title}}</template>none</div>`;
  const [bare, templated] = markersOfType({ html: html, type: COLLECTION_MARKER_TYPE });
  assert.ok(bare !== undefined && templated !== undefined);
  assert.equal(collectionMarkerKey(bare), config);
  assert.notEqual(collectionMarkerKey(templated), config);
});

test("injectCollectionEmbeds: same-config markers with different templates each receive their own rendered list", () => {
  const config = '{"type":"collection","typeKey":"recipe"}';
  const html =
    `<div data-embed-config='${config}'><template><b>{{title}}</b></template>none</div>` +
    `<div data-embed-config='${config}'><template><i>{{title}}</i></template>none</div>`;
  const [bold, italic] = markersOfType({ html: html, type: COLLECTION_MARKER_TYPE });
  assert.ok(bold !== undefined && italic !== undefined);
  const rendered = injectCollectionEmbeds({
    html,
    lists: new Map([
      [collectionMarkerKey(bold), "<b>Chili</b>"],
      [collectionMarkerKey(italic), "<i>Chili</i>"],
    ]),
  });
  assert.ok(rendered?.includes("<b>Chili</b>"), "the bold-template marker gets the bold rendering");
  assert.ok(rendered?.includes("<i>Chili</i>"), "the italic-template marker gets the italic rendering");
  assert.ok(!rendered.includes("data-embed-config"), "a hit removes the marker config");
});

test("only the built-in listing wrapper keeps the see-more identity", () => {
  const config = '{"type":"collection","typeKey":"recipe"}';
  const html = `<section class="recipes" data-jini-listing="3" data-embed-config='${config}'>No recipes yet</section>`;
  const rendered = '<div data-jini-listing="3"><article>Chili</article></div>';
  // A see-more marker is keyed by its listing key, so it never shares an entry with another marker.
  const key = `listing:3:${config}`;
  assert.equal(injectCollectionEmbeds({ html, lists: new Map([[key, rendered]]) }),
    '<section class="recipes"><div data-jini-listing="3"><article>Chili</article></div></section>');
  assert.equal(injectCollectionEmbeds({ html, lists: new Map([[key, undefined]]) }), html);
});

test("injectCollectionEmbeds leaves another widget's marker as authored even when a list is keyed exactly like it", () => {
  const html = `<nav data-embed-config='{"type":"menu","location":"header"}'>Menu fallback</nav>`;
  const [menu] = markersOfType({ html, type: MENU_MARKER_TYPE });
  assert.ok(menu !== undefined);
  assert.equal(injectCollectionEmbeds({ html, lists: new Map([[collectionMarkerKey(menu), "<b>hijacked</b>"]]) }), html);
});
