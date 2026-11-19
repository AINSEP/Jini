import { extractListingBatch, renderListingBatchDocument } from "./html.js";
import type { ListingBatchRequest, ListingJsonPage } from "./paths.js";
import type { ListingPageRequest } from "./paging.js";

export interface ListingBatchResponse {
  format: "json" | "html";
  body: string;
}

export interface ListingRequestState {
  listingBatchBody(required: { req: object; html: string }, optional?: Record<string, never>): ListingBatchResponse | undefined;
  recordListingBatchRequest(required: { req: object; listingBatch: ListingBatchRequest }, optional?: Record<string, never>): void;
  listingBatchRequestOf(required: { req: object }, optional?: Record<string, never>): ListingBatchRequest | undefined;
  recordListingPageRequest(required: { req: object; listingPage: ListingPageRequest; requestPath: string }, optional?: Record<string, never>): void;
  listingPageRequestOf(required: { req: object }, optional?: Record<string, never>): (ListingPageRequest & { requestPath: string }) | undefined;
  storeListingJsonPage<Post>(required: { listingBatch: ListingBatchRequest | undefined; keyed: ReadonlyMap<number, { posts: readonly Post[]; next: number | null }>; toItem: (required: { post: Post }) => unknown | Promise<unknown> }, optional?: Record<string, never>): Promise<void>;
  assertListingPageServed(required: { req: object; html: string }, optional?: Record<string, never>): void;
}

/** The page behind a batch URL has no see-more listing with that key, or the page behind a
 *  `/page/<n>` URL has no paged listing reaching page `n`: answered as a 404. */
export class ListingBatchNotFoundError extends Error {}

export function createListingRequestState({}, _optional = {}): ListingRequestState {
  /** See-more batch requests by request, set by the `/_more/` rewrite. */
  const listingBatchRequests = new WeakMap<object, ListingBatchRequest>();
  /** A `.json` batch request's page, recorded by the resolver for that request's key. */
  const listingJsonPages = new WeakMap<ListingBatchRequest, ListingJsonPage<unknown>>();
  /** Numbered listing page requests by request, set by the `/page/<n>` rewrite.
   *  `requestPath` is the path as requested, before the rewrite pointed the request at its page. */
  const listingPageRequests = new WeakMap<object, ListingPageRequest & { requestPath: string }>();

  /** The body for a see-more batch request, or undefined when this is an ordinary page request.
   * @throws ListingBatchNotFoundError when the requested batch is not on this page.
   */
  function listingBatchBody({ req, html }: { req: object; html: string }, _optional: Record<string, never> = {}): ListingBatchResponse | undefined {
    // A see-more batch URL answers with just that listing's next items, not the page around them.
    const listingBatch = listingBatchRequests.get(req);
    if (listingBatch?.format === "json") {
      const page = listingJsonPages.get(listingBatch);
      if (page === undefined) throw new ListingBatchNotFoundError();
      return { format: "json", body: JSON.stringify(page) };
    }
    if (listingBatch !== undefined) {
      const batch = extractListingBatch({ html, key: listingBatch.key });
      if (batch === undefined) throw new ListingBatchNotFoundError();
      return { format: "html", body: renderListingBatchDocument({ key: listingBatch.key, ...batch }) };
    }
    return undefined;
  }

  /** For a `.json` see-more request, records that listing's batch as JSON items for
   *  the response caller to send; a no-op for every other request. */
  async function storeListingJsonPage<Post>({ listingBatch, keyed, toItem }: { listingBatch: ListingBatchRequest | undefined; keyed: ReadonlyMap<number, { posts: readonly Post[]; next: number | null }>; toItem: (required: { post: Post }) => unknown | Promise<unknown> }, _optional: Record<string, never> = {}): Promise<void> {
    const jsonRequest = listingBatch?.format === "json" ? listingBatch : undefined;
    const jsonBatch = jsonRequest && keyed.get(jsonRequest.key);
    if (!jsonRequest || !jsonBatch) return;
    const items = await Promise.all(jsonBatch.posts.map(async (post) => toItem({ post })));
    listingJsonPages.set(jsonRequest, { items, nextCursor: jsonBatch.next });
  }

  /** Records `req` as a see-more batch request (the `/_more/` rewrite). */
  function recordListingBatchRequest({ req, listingBatch }: { req: object; listingBatch: ListingBatchRequest }, _optional: Record<string, never> = {}): void {
    listingBatchRequests.set(req, listingBatch);
  }

  /** The see-more batch request recorded for `req`, if any. */
  function listingBatchRequestOf({ req }: { req: object }, _optional: Record<string, never> = {}): ListingBatchRequest | undefined {
    return listingBatchRequests.get(req);
  }

  /** Records `req` as a numbered listing page request, with the path as requested (the `/page/<n>` rewrite). */
  function recordListingPageRequest({ req, listingPage, requestPath }: { req: object; listingPage: ListingPageRequest; requestPath: string }, _optional: Record<string, never> = {}): void {
    listingPageRequests.set(req, { ...listingPage, requestPath });
  }

  /** The numbered listing page request recorded for `req`, if any. */
  function listingPageRequestOf({ req }: { req: object }, _optional: Record<string, never> = {}): (ListingPageRequest & { requestPath: string }) | undefined {
    return listingPageRequests.get(req);
  }

  /** A `/page/<n>` request whose page rendered no paged listing nav (n ≥ 2 always has one) would
   *  otherwise answer as a duplicate of the page itself: it is a 404 instead. @complexity O(html). */
  function assertListingPageServed({ req, html }: { req: object; html: string }, _optional: Record<string, never> = {}): void {
    if (listingPageRequests.has(req) && !html.includes('class="jini-pagination"')) throw new ListingBatchNotFoundError();
  }

  return { listingBatchBody, recordListingBatchRequest, listingBatchRequestOf, recordListingPageRequest, listingPageRequestOf, storeListingJsonPage, assertListingPageServed };
}
