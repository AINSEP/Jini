import { describe, expect, it, vi } from "vitest";
import { createListingRequestState, ListingBatchNotFoundError } from "../request-state.js";
import { wrapListingItems } from "../html.js";
import type { ListingBatchRequest } from "../paths.js";

describe("listing request state", () => {
  it("keeps request identities and factory instances separate and captures the original path", () => {
    const state = createListingRequestState({});
    const other = createListingRequestState({});
    const first = { path: "/blog/page/3" };
    const second = {};
    const listingBatch: ListingBatchRequest = { pagePath: "/blog", key: 2, after: 12 };
    state.recordListingBatchRequest({ req: second, listingBatch });
    state.recordListingPageRequest({ req: first, listingPage: { pagePath: "/blog", page: 3 }, requestPath: first.path });
    first.path = "/blog";

    expect(state.listingBatchRequestOf({ req: second })).toBe(listingBatch);
    expect(state.listingBatchRequestOf({ req: first })).toBeUndefined();
    expect(state.listingPageRequestOf({ req: first })).toEqual({ pagePath: "/blog", page: 3, requestPath: "/blog/page/3" });
    expect(state.listingPageRequestOf({ req: second })).toBeUndefined();
    expect(other.listingBatchRequestOf({ req: second })).toBeUndefined();
    expect(other.listingPageRequestOf({ req: first })).toBeUndefined();
  });

  it("rejects missing HTML and JSON batches", () => {
    const state = createListingRequestState({});
    const first = {};
    const second = {};
    state.recordListingBatchRequest({ req: first, listingBatch: { pagePath: "/", key: 1, after: 12 } });
    state.recordListingBatchRequest({ req: second, listingBatch: { pagePath: "/", key: 1, after: 12, format: "json" } });

    expect(() => state.listingBatchBody({ req: first, html: "<main/>" })).toThrow(ListingBatchNotFoundError);
    expect(() => state.listingBatchBody({ req: second, html: "<main/>" })).toThrow(ListingBatchNotFoundError);
  });

  it("extracts the requested HTML key rather than the first batch", () => {
    const state = createListingRequestState({});
    const req = {};
    state.recordListingBatchRequest({ req, listingBatch: { pagePath: "/blog", key: 2, after: 12 } });
    const html = wrapListingItems({ key: 1, items: "<p>first</p>" }) + wrapListingItems({ key: 2, items: "<p>second</p>" });

    expect(state.listingBatchBody({ req, html })).toEqual({
      format: "html",
      body: '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body><div data-jini-listing-batch="2"><p>second</p></div></body></html>',
    });
    expect(state.listingBatchBody({ req: {}, html })).toBeUndefined();
  });

  it("records projected JSON items in order with the cursor under the original batch identity", async () => {
    const state = createListingRequestState({});
    const req = {};
    const listingBatch: ListingBatchRequest = { pagePath: "/blog", key: 2, after: 12, format: "json" };
    state.recordListingBatchRequest({ req, listingBatch });
    await state.storeListingJsonPage({
      listingBatch,
      keyed: new Map([[1, { posts: ["wrong"], next: null }], [2, { posts: ["first", "second"], next: 24 }]]),
      toItem: async ({ post }) => ({ title: post }),
    });

    expect(state.listingBatchBody({ req, html: "" })).toEqual({
      format: "json",
      body: '{"items":[{"title":"first"},{"title":"second"}],"nextCursor":24}',
    });
  });

  it("does not project an absent key, an absent request, or an HTML batch", async () => {
    const state = createListingRequestState({});
    const toItem = vi.fn(({ post }: { post: string }) => post);
    const keyed = new Map([[1, { posts: ["first"], next: null }]]);
    await state.storeListingJsonPage({ listingBatch: { pagePath: "/", key: 2, after: 12, format: "json" }, keyed, toItem });
    await state.storeListingJsonPage({ listingBatch: undefined, keyed, toItem });
    await state.storeListingJsonPage({ listingBatch: { pagePath: "/", key: 1, after: 12 }, keyed, toItem });

    expect(toItem).not.toHaveBeenCalled();
  });

  it("rejects a numbered page that rendered no pagination markup", () => {
    const state = createListingRequestState({});
    const req = {};
    state.recordListingPageRequest({ req, listingPage: { pagePath: "/blog", page: 2 }, requestPath: "/blog/page/2" });

    expect(() => state.assertListingPageServed({ req, html: "<main/>" })).toThrow(ListingBatchNotFoundError);
  });
});
