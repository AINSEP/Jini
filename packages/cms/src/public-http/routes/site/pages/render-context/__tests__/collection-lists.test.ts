import { describe, expect, it, vi } from "vitest";
import type { ContentTypeRecord } from "@jini-ai/core/contracts/content-types";
import type { EntryRecord } from "../../../../../../entries/index.js";
import * as listing from "../../../../../../listing/index.js";
import { markersOfType, COLLECTION_MARKER_TYPE } from "../../../../../../widgets/markers/index.js";
import { parseCollectionListConfig, humanizeFieldName, entryPublicHref } from "../../../../../../entries/site/public-list.js";
import { formatDateLabel, resolveSiteTimeZoneSafely } from "../../../../../../widgets/date-label.js";
import { resolveCollectionListsForRender, type CollectionListsCollaborators, type CollectionListsRenderDeps } from "../collection-lists.js";

/** @file Collection-marker resolution: the host's injected wrapper attribute reaches the markup, misses keep their fallback. */

const contentType = {
  workspaceId: "w1", key: "books", label: "Books", status: "active", version: 1, tombstonedAt: null,
  fields: [{ name: "author", kind: "text" }],
} as unknown as ContentTypeRecord;
const row = {
  id: "e1", type: "books", slug: "dune", title: "Dune", publishedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  fieldsJson: { ext: { site: { author: "Herbert" } } },
} as unknown as EntryRecord;

/** The real domain functions, bound the way a host binds them from the public subpaths. */
const collaborators: CollectionListsCollaborators = {
  listing: {
    collectionMarkerKey: listing.collectionMarkerKey, splitCollectionMarkerInner: listing.splitCollectionMarkerInner,
    renderEntryList: listing.renderEntryList, listingBatchPath: listing.listingBatchPath,
    listingKeyOfAttributes: listing.listingKeyOfAttributes, readListingBatch: listing.readListingBatch,
    renderListingMore: listing.renderListingMore,
  },
  markers: { markersOfType, COLLECTION_MARKER_TYPE },
  entries: { parseCollectionListConfig, humanizeFieldName, entryPublicHref },
  dates: { formatDateLabel, resolveSiteTimeZoneSafely },
};

function deps(found: ContentTypeRecord | null): Pick<CollectionListsRenderDeps, "workspaceId" | "contentTypeRepo" | "entryRepo" | "entryListAttribute" | "collaborators"> {
  return {
    collaborators,
    workspaceId: "w1",
    contentTypeRepo: { findByKey: async () => found },
    entryRepo: { listPublishedForDisplay: async () => [row] },
    entryListAttribute: "data-host-entry-list",
  };
}

const marker = `<div data-embed-config='{"type":"collection","id":"books"}'>fallback</div>`;

describe("resolveCollectionListsForRender", () => {
  it("returns an empty map for html without collection markers", async () => {
    expect((await resolveCollectionListsForRender({ deps: deps(contentType), html: "<p>none</p>", pagePath: "/" })).size).toBe(0);
  });

  it("records a miss as undefined when the content type is unknown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const map = await resolveCollectionListsForRender({ deps: deps(null), html: marker, pagePath: "/" });
    expect([...map.values()]).toEqual([undefined]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders found entries inside the host's injected wrapper attribute", async () => {
    const map = await resolveCollectionListsForRender({ deps: deps(contentType), html: marker, pagePath: "/" });
    const [html] = [...map.values()];
    expect(html).toContain("data-host-entry-list");
    expect(html).toContain("Dune");
  });
});
