import { describe, it, expect } from "vitest";

import { COLLECTION_LIST_FAQ_PAGE, COLLECTION_LIST_LAYOUTS, isCollectionListLayout } from "../contracts.js";
import { entryPublicHref, humanizeFieldName, parseCollectionListConfig, DEFAULT_COLLECTION_LIST_LIMIT, MAX_COLLECTION_LIST_LIMIT } from "../public-list.js";
import { toolMetadata } from "@jini-ai/core/tool-metadata/entries";
import { contributeEntriesTools } from "../tool-registrations.js";
import { extractHtmlEntryRefs } from "../../../widgets/entry-refs-extractor.js";
import type { ContentTypeRecord } from "@jini-ai/core/contracts/content-types";
import type { UUID } from "@jini-ai/core/primitives";

/** @file Characterizes the site entries surface: layout vocabulary, public-list helpers, tool seam. */
describe("site entries surface", () => {
  it("accepts only the declared collection-list layouts", () => {
    expect(COLLECTION_LIST_LAYOUTS).toEqual(["cards", "list", "accordion", "carousel"]);
    expect(isCollectionListLayout({ value: "accordion" })).toBe(true);
    expect(isCollectionListLayout({ value: "grid" })).toBe(false);
    expect(COLLECTION_LIST_FAQ_PAGE).toBe("faq-page");
  });

  it("humanizes field names into sentence-case labels", () => {
    expect(humanizeFieldName({ name: "docs_page" })).toBe("Docs page");
    expect(humanizeFieldName({ name: "heroImageUrl" })).toBe("Hero image url");
    expect(humanizeFieldName({ name: "__" })).toBe("");
  });

  it("has no public href seam wired yet", () => {
    expect(entryPublicHref({ _typeKey: "post", _slug: "hello" })).toBeNull();
  });

  it("exposes collection-list limits and the config parser", () => {
    expect(DEFAULT_COLLECTION_LIST_LIMIT).toBe(6);
    expect(MAX_COLLECTION_LIST_LIMIT).toBe(24);
    expect(typeof parseCollectionListConfig).toBe("function");
  });

  it("contributes the entries domain with metadata for its five tools", () => {
    expect(Object.keys(toolMetadata).sort()).toEqual([
      "collections_entry_create",
      "collections_entry_list",
      "collections_entry_publish",
      "collections_entry_unpublish",
      "collections_entry_update",
    ]);
    const contributor = contributeEntriesTools();
    expect(contributor.domain).toBe("entries");
    expect(typeof contributor.build).toBe("function");
  });

  it("finds no entry refs in html without embed markers", () => {
    const id = "00000000-0000-4000-8000-000000000001" as UUID;
    expect(extractHtmlEntryRefs({ workspaceId: id, sourceEntryId: id, html: "<p>plain</p>" })).toEqual([]);
  });

  it("reports a rejected marker through the injected report port with its source entry id", () => {
    const id = "00000000-0000-4000-8000-000000000001" as UUID;
    const reports: { message: string; sourceEntryId: UUID }[] = [];
    const rows = extractHtmlEntryRefs(
      { workspaceId: id, sourceEntryId: id, html: `<div data-embed-config='{"type":"widget","id":}'></div>` },
      { report: (r) => reports.push(r) },
    );
    expect(rows).toEqual([]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.sourceEntryId).toBe(id);
    expect(reports[0]?.message).toMatch(/UNINDEXED/);
    expect(reports[0]?.message).toMatch(/safe-delete/i);
  });
});

const author = { name: "author", kind: "text", required: false, queryable: true } as const;
const pages = { name: "pages", kind: "integer", required: false, queryable: true } as const;
const featured = { name: "featured", kind: "boolean", required: false, queryable: true } as const;
const collection: ContentTypeRecord = {
  workspaceId: "ws-1", key: "books", label: "Books", fields: [author, pages, featured], status: "active", version: 7, tombstonedAt: null,
};

it("keeps all authored scalar predicates, sorts on the chosen field, and displays fields in authored order", () => {
  expect(parseCollectionListConfig({ contentType: collection, config: {
    where: { author: "Herbert", featured: false, pages: 0 }, sort: "-pages", fields: ["pages", "author"],
    listSize: 99, columns: 2, layout: "accordion", structuredData: "faq-page",
  } }, { limitKey: "listSize" })).toEqual({
    ok: true,
    query: { type: "books", where: [{ field: "author", value: "Herbert" }, { field: "featured", value: false }, { field: "pages", value: 0 }],
      sort: { by: { field: "pages" }, dir: "desc" }, limit: 24 },
    display: { columns: 2, layout: "accordion", fields: [pages, author], structuredData: "faq-page" },
  });
});

it.each<[string, string, "asc" | "desc"]>([
  ["oldest", "published", "asc"],
  ["updated", "updated", "desc"],
  ["-updated", "updated", "asc"],
  ["title", "title", "asc"],
  ["-title", "title", "desc"],
])("resolves the authored %s sort direction", (sort, by, dir) => {
  expect(parseCollectionListConfig({ contentType: collection, config: { sort, where: null, fields: [] } })).toEqual({
    ok: true, query: { type: "books", where: [], sort: { by, dir }, limit: 6 },
    display: { columns: 3, layout: "cards", fields: [] },
  });
});

it.each<[unknown, string]>([
  [{ where: [] }, "where must be an object of {field: value} pairs"],
  [{ where: { curator: "Herbert" } }, 'unknown field in where: "curator"'],
  [{ where: { featured: [true] } }, "non-scalar value for where.featured"],
  [{ sort: "-curator" }, 'unknown field in sort: "-curator"'],
  [{ fields: ["author", "curator"] }, 'unknown field in fields: "curator"'],
])("refuses config %j instead of silently widening the query", (config, reason) => {
  expect(parseCollectionListConfig({ contentType: collection, config })).toEqual({ ok: false, reason });
});

it("does not expose system and tombstoned types through public collection listings", () => {
  expect(parseCollectionListConfig({ contentType: { ...collection, key: "widget" }, config: {} }))
    .toEqual({ ok: false, reason: 'system content type: "widget"' });
  expect(parseCollectionListConfig({ contentType: { ...collection, status: "tombstone", tombstonedAt: "2026-11-26T00:00:00Z" }, config: {} }))
    .toEqual({ ok: false, reason: 'content type is tombstoned: "books"' });
});
