import assert from "node:assert/strict";
import { test } from "vitest";
import { extractEntryRefs, extractHtmlEntryRefs } from "../entry-refs-extractor.js";
import type { EntryRefRow } from "../ports.js";

const source = { workspaceId: "workspace-a", sourceEntryId: "source-a" };

test("indexes typed config references across namespaces without treating arbitrary strings as references", () => {
  const refs = extractEntryRefs({
    ...source, sourceEntryType: "widget", bodyJson: null,
    fieldsExt: {
      invalidNamespace: null,
      invalidConfig: { config: [] },
      widget: { widgetType: "gallery", config: { formDefinitionId: "contact", categoryTermId: "sports", menuRef: "primary", blankRefId: "", numericId: 42, label: "not-an-id", items: [{ slug: "cover" }] } },
      extension: { widgetType: "gallery", config: { detailRefId: "detail", items: [{ slug: "not-a-widget-image" }] } },
    },
  });
  const expected: EntryRefRow[] = [
    { ...source, sourceKind: "config-field", fieldPath: "fields.ext.widget.config.formDefinitionId", targetKind: "entry", targetId: "contact" },
    { ...source, sourceKind: "config-field", fieldPath: "fields.ext.widget.config.categoryTermId", targetKind: "term", targetId: "sports" },
    { ...source, sourceKind: "config-field", fieldPath: "fields.ext.widget.config.menuRef", targetKind: "entry", targetId: "primary" },
    { ...source, sourceKind: "config-field", fieldPath: "fields.ext.widget.config.media[0]", targetKind: "asset", targetId: "cover" },
    { ...source, sourceKind: "config-field", fieldPath: "fields.ext.extension.config.detailRefId", targetKind: "entry", targetId: "detail" },
  ];
  assert.deepEqual(refs, expected);
});

test("indexes authored media in widget embeds even when the adjacent media selection is invalid", () => {
  const refs = extractEntryRefs({
    ...source, sourceEntryType: "post", fieldsExt: {},
    bodyJson: { type: "doc", content: [{ type: "widgetEmbed", attrs: { widgetEntryId: "gallery-instance", content: { items: [{ slug: "cover" }, { slug: "byline" }, { slug: "not/a/slug" }] } } }] },
  });
  assert.deepEqual(refs, [
    { ...source, sourceKind: "widget-embed", fieldPath: "bodyJson.content[0]", targetKind: "entry", targetId: "gallery-instance" },
    { ...source, sourceKind: "config-field", fieldPath: "bodyJson.content[0].attrs.content.media[0]", targetKind: "asset", targetId: "cover" },
    { ...source, sourceKind: "config-field", fieldPath: "bodyJson.content[0].attrs.content.media[1]", targetKind: "asset", targetId: "byline" },
  ]);
});

test("indexes repeated gallery media at its authored positions even with an invalid layout", () => {
  const html = `<div data-embed-config='{"type":"gallery","layout":"typo","images":[{"mediaId":"cover"},{"src":"https://example.test/photo.jpg"},{"mediaId":"cover"}]}'>Fallback</div>`;
  assert.deepEqual(extractHtmlEntryRefs({ ...source, html }), [
    { ...source, sourceKind: "page-html-embed", fieldPath: "bodyHtml[embed:gallery#1].images[0].mediaId", targetKind: "asset", targetId: "cover" },
    { ...source, sourceKind: "page-html-embed", fieldPath: "bodyHtml[embed:gallery#1].images[2].mediaId", targetKind: "asset", targetId: "cover" },
  ]);
});
