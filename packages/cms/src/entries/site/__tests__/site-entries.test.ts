import { describe, it, expect } from "vitest";

import { COLLECTION_LIST_FAQ_PAGE, isCollectionListLayout } from "../render-entry.js";
import { COLLECTION_LIST_LAYOUTS } from "../contracts.js";
import { entryPublicHref, humanizeFieldName, DEFAULT_COLLECTION_LIST_LIMIT, MAX_COLLECTION_LIST_LIMIT } from "../public-list.js";
import { parseCollectionListConfig } from "../public-read.js";
import { toolMetadata } from "../tool-metadata.js";
import { contributeEntriesTools } from "../tool-registrations.js";
import { extractHtmlEntryRefs } from "../../../widgets/site/entry-refs-extractor.js";
import type { UUID } from "@jini-ai/core/primitives";

/** @file Characterizes the site entries surface: layout vocabulary, public-list helpers, tool seam. */
describe("site entries surface", () => {
  it("accepts only the declared collection-list layouts", () => {
    expect(COLLECTION_LIST_LAYOUTS).toEqual(["cards", "list", "accordion", "carousel"]);
    expect(isCollectionListLayout("accordion")).toBe(true);
    expect(isCollectionListLayout("grid")).toBe(false);
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
});
