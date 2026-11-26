import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { FeaturedImageView as StaticFeaturedImage, featuredImageView } from "../../../../http/site/render/template-render-data.js";
import { markersOfType, POST_PREVIEWS_MARKER_TYPE, type EmbedMarker } from "../../../../../widgets/markers/marker.js";
import { extractListingCardTemplate, listingBatchPath, listingKeyOfAttributes, readListingBatch, readListingPage, renderListingPageNav, type ListingSource, type ListingBatchRequest } from "../../../../../listing/index.js";
import { postDisplayDateIso } from "@jini-ai/core/scheduled-publish";
import { formatDateLabel, resolveSiteTimeZoneSafely, type SiteTimeZonePort } from "../../../../../widgets/date-label.js";
import { ListingBatchNotFoundError, type ListingRequestState } from "../../../../../listing/request-state.js";
import { postAuthorForDisplay } from "@jini-ai/core/contracts/site/post-author";
import type { deriveExcerpt } from "../../../../../seo/seo.js";
import { extractPlainTextFromHtml } from "../../../../../seo/html-plain-text.js";
import type { AssignedTermView } from "../../../../../taxonomy/index.js";

type StaticPostPreview = { readonly title: string; readonly href: string; readonly dateIso: string; readonly dateLabel: string; readonly featuredImage?: StaticFeaturedImage | null };
type StaticListingBatch = { readonly items: readonly StaticPostPreview[]; readonly nextHref?: string };
type StaticPostPreviewsPage = { readonly items: readonly StaticPostPreview[]; readonly nav: string };
export type PostPreviewsResult = { previews: readonly StaticPostPreview[]; batches: ReadonlyMap<number, StaticListingBatch>; page?: StaticPostPreviewsPage };

/** One see-more listing's visible posts, the cursor of its next batch (`null` when none), and that
 *  batch's URL. */
export interface KeyedPostPreviewBatch { posts: readonly PostRecord[]; next: number | null; nextHref?: string }

/** One post as a see-more JSON batch item: public fields only, the same ones its card shows plus the
 *  excerpt, term names and a byline the post shows. */
interface ListingJsonItem {
  readonly title: string;
  readonly href: string;
  readonly date: string;
  readonly dateLabel: string;
  readonly excerpt?: string;
  readonly cover: StaticFeaturedImage | null;
  readonly terms: readonly string[];
  readonly author?: string;
}

function toListingJsonItem(
  { deps, post, preview, terms }: { deps: Pick<Parameters<typeof resolvePostPreviewsForRender>[0]["deps"], "deriveExcerpt">; post: PostRecord; preview: StaticPostPreview; terms: readonly AssignedTermView[] },
  _optional: Record<string, never> = {}
): ListingJsonItem {
  const excerpt = deps.deriveExcerpt({ post, postRepo: { extractPlainText: ({ html }) => extractPlainTextFromHtml({ html }) } });
  const author = postAuthorForDisplay({ post });
  return {
    title: preview.title,
    href: preview.href,
    date: preview.dateIso,
    dateLabel: preview.dateLabel,
    ...(excerpt !== undefined ? { excerpt } : {}),
    cover: preview.featuredImage ?? null,
    terms: terms.map((term) => term.termName),
    ...(author !== null ? { author } : {}),
  };
}

/** Pure display formatting for a post-previews card's date — the one place this file turns
 *  the post's display date ({@link postDisplayDateIso}: `publishAt` when set, else `updatedAt`) into
 *  the short label a card shows (e.g. "Sep 3, 2026"). `PostRecord` has no `publishedAt` (see
 *  `static-render.ts`'s `StaticPostPreview.dateIso` doc for why). A malformed timestamp —
 *  should not occur for a real stored row — degrades to the raw ISO string rather than
 *  "Invalid Date", a legible if ugly output over a broken one. Bug D: the day is the site's
 *  (`timeZone`, from `core.site.timezone`), not the server's UTC. */
export function formatPostPreviewDate({ iso, timeZone }: { iso: string; timeZone: string }, _optional = {}): string {
  return formatDateLabel({ iso }, { timeZone });
}

/**
 * Post-previews marker resolution (2026-09-03) — resolves the bounded, ADR-030 §4
 * visibility-filtered {@link StaticPostPreview}s a `{"type":"post-previews"}` marker in `pageHtml`
 * needs, or `undefined` when `pageHtml` carries no such marker at all (the "pay for the query only
 * when present" gate — REQ 2 of the post-previews marker's own spec). A `data-jini-see-more` marker
 * also gets its next batch URL (`<pagePath>/_more/<key>/<after>`) while more posts remain.
 *
 * Applies the SAME member-access rule (`decidePostMemberAccess`, as `isVisible` of
 * `readListingBatch`, so hidden rows are skipped before a batch is filled) the
 * `filterVisiblePosts` gate on the home/related-posts listing already applies to
 * `posts` — see that function's own doc for why gating only SOME listings is protection that looks
 * real and isn't (ADR-030 §4); this listing gets no exception. `kind: "post"` and
 * `status: "published"` are already enforced by the bounded repo query itself
 * (`listPublishedPostPreviews` -> `PostRepoPort.listPublishedPreviews`), so a Page — including
 * whichever one claims the reserved `/` root slug — can never appear in this listing by
 * construction; not re-checked here.
 *
 * @complexity At most 4 bounded `listPublishedPreviews` reads per batch (one batch for the plain
 * markers at their widest limit, one per see-more marker), each `size + 1` rows. Cover
 * selection scans those visible bodies and resolves distinct media refs with one MIME batch;
 * it never adds an unbounded post query or resolves hidden posts' cover metadata.
 */
export async function resolvePostPreviewsForRender({ deps, pageHtml, pagePath }: { deps: {
  workspaceId: string; listingBatch: ListingBatchRequest | undefined; listingPage: number | undefined;
  listPublishedPostPreviews(required: { limit: number; offset: number }): Promise<{ posts: readonly PostRecord[] }>;
  decidePostMemberAccess(required: { post: PostRecord }): { allowed: boolean };
  postPreviewsBatchSize(marker: Pick<EmbedMarker, "config">): number;
  isPagedPostPreviewsMarker(marker: Pick<EmbedMarker, "config">): boolean;
  resolveMediaAssetMetadataForRender(required: { post: undefined }, optional: { listed: readonly PostRecord[] }): Promise<ReadonlyMap<string, MediaAssetRenderMeta>>;
  resolveMediaTransformVersionsForRender(): Promise<ReadonlyMap<string, number>>;
  siteTimeZoneDep(): { siteTimeZone?: SiteTimeZonePort };
  postPublicPath(required: { slug: string }): string;
  featuredImageView: typeof featuredImageView;
  resolveAssignedTermsForRender(required: { post: PostRecord }): Promise<readonly AssignedTermView[]>;
  listingState: Pick<ListingRequestState, "storeListingJsonPage">;
  deriveExcerpt: typeof deriveExcerpt;
}; pageHtml: string; pagePath: string }, _optional = {}): Promise<PostPreviewsResult | undefined> {
  const markers = markersOfType({ html: pageHtml, type: POST_PREVIEWS_MARKER_TYPE });
  if (markers.length === 0) return undefined;

  const source: ListingSource<PostRecord> = async ({ offset, limit }) =>
    (await deps.listPublishedPostPreviews({ limit, offset })).posts;
  const isVisible = (post: PostRecord): boolean => deps.decidePostMemberAccess({ post }).allowed;

  // Plain markers share one batch at the widest limit (each slices its own); a see-more marker
  // (`data-jini-listing`) reads its own batch, from `after` when this request asks for that key. A
  // listing with a `<template data-jini-card>` loads its next batches as JSON (`.json` batch URLs).
  const plainLimit = widestPlainPostPreviewsLimit({ deps, markers });
  const plain = plainLimit > 0 ? (await readListingBatch({ source, after: 0, size: plainLimit }, { isVisible })).items : [];
  const keyed = await readKeyedPostPreviewBatches({ deps, markers, source, isVisible, pagePath });
  const paged = await readPagedPostPreviews({ deps, markers, source, isVisible, pagePath });

  const listed = [...plain, ...[...keyed.values()].flatMap((batch) => batch.posts), ...(paged?.posts ?? [])];
  const [mediaAssetMetadata, mediaTransformVersions] = await Promise.all([
    deps.resolveMediaAssetMetadataForRender({ post: undefined }, { listed }),
    deps.resolveMediaTransformVersionsForRender(),
  ]);
  // Bug D: card dates are the site's calendar day. `deps` is the full route deps at runtime; its
  // narrowed type simply does not name the optional `siteTimeZone`.
  const timeZone = await resolveSiteTimeZoneSafely({ workspaceId: deps.workspaceId }, deps.siteTimeZoneDep());
  const toPreview = (post: PostRecord): StaticPostPreview => {
    const dateIso = postDisplayDateIso(post);
    return { title: post.title, href: deps.postPublicPath({ slug: post.slug }), dateIso, dateLabel: formatPostPreviewDate({ iso: dateIso, timeZone }), featuredImage: deps.featuredImageView({ ctx: { mediaAssetMetadata, mediaTransformVersions }, post }) };
  };
  const batches = new Map<number, StaticListingBatch>();
  for (const [key, batch] of keyed) batches.set(key, { items: batch.posts.map(toPreview), ...(batch.nextHref !== undefined ? { nextHref: batch.nextHref } : {}) });
  /** For a `.json` see-more request, records that listing's batch as JSON items for
   *  `finalizePublicPageHtml` to send; a no-op for every other request. */
  await deps.listingState.storeListingJsonPage({ listingBatch: deps.listingBatch, keyed, toItem: async ({ post }) => toListingJsonItem({ deps, post, preview: toPreview(post), terms: await deps.resolveAssignedTermsForRender({ post }) }) });
  const page = paged && { items: paged.posts.map(toPreview), nav: paged.nav };
  return { previews: plain.map(toPreview), batches, ...(page ? { page } : {}) };
}

/**
 * Bug C (2026-10-22) — the requested page (`deps.listingPage`, else 1) of a page's `paged`
 * post-previews listing, sized by the first paged marker, with its rendered prev/next nav; every
 * paged marker on the page shows this one page. `undefined` when the page carries no paged marker.
 * A page past the last throws {@link ListingBatchNotFoundError}, answered as the ordinary 404.
 * @complexity One visible-count scan of the published posts (`readListingPage`).
 */
async function readPagedPostPreviews({ deps, markers, source, isVisible, pagePath }: {
  deps: Pick<Parameters<typeof resolvePostPreviewsForRender>[0]["deps"], "listingPage" | "isPagedPostPreviewsMarker" | "postPreviewsBatchSize">;
  markers: readonly EmbedMarker[];
  source: ListingSource<PostRecord>;
  isVisible: (post: PostRecord) => boolean;
  pagePath: string;
}): Promise<{ posts: readonly PostRecord[]; nav: string } | undefined> {
  const { isPagedPostPreviewsMarker, postPreviewsBatchSize } = deps;
  const marker = markers.find(isPagedPostPreviewsMarker);
  if (marker === undefined) return undefined;
  const page = await readListingPage({ source, page: deps.listingPage ?? 1, pageSize: postPreviewsBatchSize(marker) }, { isVisible, pagePath });
  if (page === undefined) throw new ListingBatchNotFoundError();
  return { posts: page.items, nav: renderListingPageNav({ page }) };
}

/** The widest batch size among plain (non-see-more, non-paged) post-previews markers; `0` when every
 *  marker is a see-more or paged listing. @complexity O(m) over markers. */
function widestPlainPostPreviewsLimit({ deps, markers }: { deps: Pick<Parameters<typeof resolvePostPreviewsForRender>[0]["deps"], "isPagedPostPreviewsMarker" | "postPreviewsBatchSize">; markers: readonly EmbedMarker[] }): number {
  const { postPreviewsBatchSize } = deps;
  return markers.reduce((widest, marker) => (isPlainPostPreviewsMarker({ deps, marker }) ? Math.max(widest, postPreviewsBatchSize(marker)) : widest), 0);
}

/** Neither a see-more listing nor a paged one: renders a slice of the shared plain batch. @complexity O(attrs). */
function isPlainPostPreviewsMarker({ deps, marker }: { deps: Pick<Parameters<typeof resolvePostPreviewsForRender>[0]["deps"], "isPagedPostPreviewsMarker">; marker: EmbedMarker }): boolean {
  const { isPagedPostPreviewsMarker } = deps;
  return listingKeyOfAttributes({ attrs: marker.attrs }) === undefined && !isPagedPostPreviewsMarker(marker);
}

/** Reads each distinct see-more listing's batch (first marker per key wins), in marker order.
 *  @complexity One bounded batch read per distinct listing key. */
async function readKeyedPostPreviewBatches({ deps, markers, source, isVisible, pagePath }: {
  deps: Pick<Parameters<typeof resolvePostPreviewsForRender>[0]["deps"], "listingBatch" | "postPreviewsBatchSize">;
  markers: readonly EmbedMarker[];
  source: ListingSource<PostRecord>;
  isVisible: (post: PostRecord) => boolean;
  pagePath: string;
}): Promise<Map<number, KeyedPostPreviewBatch>> {
  const { postPreviewsBatchSize } = deps;
  const keyed = new Map<number, KeyedPostPreviewBatch>();
  for (const marker of markers) {
    const key = listingKeyOfAttributes({ attrs: marker.attrs });
    if (key === undefined || keyed.has(key)) continue;
    const after = deps.listingBatch?.key === key ? deps.listingBatch.after : 0;
    const batch = await readListingBatch({ source, after, size: postPreviewsBatchSize(marker) }, { isVisible });
    keyed.set(key, toKeyedPostPreviewBatch({ batch, marker, key, pagePath }));
  }
  return keyed;
}

/** A read batch plus its next-batch URL (`.json` when the listing carries a card template). */
function toKeyedPostPreviewBatch({ batch, marker, key, pagePath }: {
  batch: { items: readonly PostRecord[]; hasMore: boolean; next: number };
  marker: EmbedMarker;
  key: number;
  pagePath: string;
}): KeyedPostPreviewBatch {
  if (!batch.hasMore) return { posts: batch.items, next: null };
  const format = extractListingCardTemplate({ html: marker.inner }) === undefined ? {} : { format: "json" as const };
  return { posts: batch.items, next: batch.next, nextHref: listingBatchPath({ pagePath, key, after: batch.next, ...format }) };
}
