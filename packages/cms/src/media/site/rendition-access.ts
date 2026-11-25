import type { AssetReferenceScan, AssetReferenceIndex, MediaAccessEvidence } from "./access-evidence.js";
import { collectReferencedMediaKeys, collectPlacedWidgetMediaKeys } from "../../publish/content/media-references.js";
import { parseWidgetInstancePayload } from "../../widgets/entry-payload.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import type { PostRecord } from "../../posts/post.js";
import type { MediaRecord } from "../types.js";

type AccessEvidencePost = { readonly memberAccessJson?: string | null };
export interface RenditionAccess {
  decide(required: { idOrSlug: string; readEntitlement: (required: Record<string, never>) => Promise<(required: { entry: AccessEvidencePost }) => boolean> }, optional?: Record<string, never>): Promise<{ gated: boolean; allowed: boolean; record: MediaRecord | null }>;
}

export function createRenditionAccess(required: {
  workspaceId: string; cache: ReturnType<MediaAccessEvidence["getCache"]>;
  nowMs(required: Record<string, never>): number;
  readEntries(required: { workspaceId: string }): Promise<readonly PostRecord[]>;
  readWidgetRows: ((required: { workspaceId: string }) => Promise<readonly { id: string; slug: string; fieldsJson: unknown; deletedAt?: string | null }[]>) | undefined;
  findMedia(required: { workspaceId: string; idOrSlug: string }): Promise<MediaRecord | null>;
  readRetiredSlugs(required: { workspaceId: string; mediaId: string }): Promise<readonly string[]>;
  isGated(required: { entry: AccessEvidencePost }): boolean;
}, _optional = {}): RenditionAccess {
  return { decide: (input, options = {}) => resolveMediaAccessDecision({ deps: required, ...input }, options) };
}

/** Local copy of `pages.ts`'s own (file-private) `isPlainObject`/`collectMediaRefAssetIds` walk —
 *  duplicated rather than imported, same "each side owns its own copy of a small pure helper"
 *  precedent `9bf661e9`'s content-API gating fix already followed for `readRawCookie`/
 *  `createMemberAccessResolver` below. Walks a TipTap-shaped `bodyJson` tree collecting every
 *  ref-based media node's `assetId` (ADR-027 §4's `{assetId, transformName}` shape) — both the
 *  legacy image-only ref shape and the generic `media` node (2026-09-11, `render.ts`'s
 *  `renderDocMedia`'s own doc) share this collection, since both key off the same `assetId` attr.
 *  Widened 2026-09-11 (this route's own gating-bypass fix, renamed from `collectImageAssetIds`
 *  accordingly) to match `pages.ts`'s and `resolver-service.ts`'s own collectors, which were
 *  widened the same day — before this fix, a members-only entry embedding an asset through the new
 *  `media` node (the admin composer's Media button/drag-drop/paste all insert it now) produced an
 *  EMPTY gating set here, and {@link resolveMediaAccessDecision}'s fail-open default served it to
 *  anonymous visitors with a year-long immutable CDN header. A legacy `src`-only node still
 *  contributes nothing, matching `render.ts`'s own `image` case, which never reads `src` at all once
 *  a ref shape exists. */
function collectMediaRefAssetIds({ root, out }: { root: unknown; out: Set<string> }, _optional = {}): void {
  // An explicit stack, not recursion: a stored document's nesting depth is attacker/import-controlled
  // and a 5000-deep list overflowed the call stack here (GET /:slug -> 500) before `render.ts`'s own
  // MAX_RENDER_DEPTH placeholder could ever apply. Children are pushed in reverse so the walk stays
  // pre-order, the same visit order the recursive version had.
  // Completeness matters most here: this set gates members-only media, so the walk must never stop
  // early at a depth bound — an asset it misses would be served under the fail-open default.
  // The shared authored-reference collector owns that iterative walk, including placement content.
  for (const key of collectReferencedMediaKeys({ state: { bodyJson: root } })) out.add(key);
}

/**
 * The body formats this route's own reference scan knows how to read end to end:
 * `"doc"` through {@link collectMediaRefAssetIds}'s `bodyJson` walk, `"html"` through
 * {@link addHtmlEmbedAssetIds}'s marker scan. Deliberately a runtime set rather than a reliance on
 * `PostBodyFormat` being a closed union at compile time — a `bodyFormat` value arrives from a
 * database column (`repo.sqlite.ts`'s `toRecord`), so a THIRD format added later reaches this
 * function as data long before any type error would point at this file. See
 * {@link EntryAssetScan}'s `readable` flag for what happens when one does.
 */
const READABLE_BODY_FORMATS: ReadonlySet<string> = new Set(["doc", "html"]);

/** Whether the author has marked this entry as anything other than freely public. Extracted so the
 *  three call sites that ask this question (live-referrer candidacy, the public-referrer shortcut,
 *  and opaque-body classification) share one definition of "gated" instead of three inline
 *  `resolvePostMemberAccess(...).visibility` reads that could drift apart. */
function isGatedEntry({ entry, deps }: { entry: AccessEvidencePost; deps: Parameters<typeof createRenditionAccess>[0] }): boolean {
  return deps.isGated({ entry: typeof entry.memberAccessJson === "string" || entry.memberAccessJson === null ? { memberAccessJson: entry.memberAccessJson } : {} });
}

/**
 * Adds every `data-embed-config` MEDIA marker's asset id found in an `"html"`-format Page's
 * `body_html` to `out`.
 *
 * This is the second half of "which entries reference this asset", and it was missing until
 * 2026-09-05. `collectMediaRefAssetIds` walks `bodyJson` only, so it can see a `"doc"`-format entry's
 * ref-based TipTap `image` nodes and nothing else — but an `"html"`-format Page's real content
 * lives in `bodyHtml` (`post.ts`'s own doc: `bodyJson` stays an empty non-null object for those
 * rows), and video has NO TipTap node type in this codebase at all: `render.ts`'s `renderVideoTag`
 * is reached exclusively from `renderWidgetMediaImage`, i.e. from a resolved
 * `data-embed-config='{"type":"media","id":"…"}'` marker. So before this function existed, every
 * embed on an `"html"` Page and every video anywhere was invisible to the gate.
 *
 * Uses the shared authored-reference collector, backed by `scanEmbedMarkers`, rather than `widgets/`'s
 * `scanHtmlEmbeds` wrapper, for two reasons: `scanHtmlEmbeds` truncates at
 * `MAX_HTML_EMBEDS_PER_PAGE` (a render-time resource bound — a gate that stopped scanning at
 * marker 50 would hand marker 51 straight to an anonymous caller), and it discards `rejected`,
 * which is exactly the signal {@link scanEntryAssets} needs to know its own scan was incomplete.
 * `marker.type`/`marker.id` are the parsed `config.type`/`config.id` that
 * `resolver-service.ts`'s `parseMediaEmbedRef` reads as `{assetId, transformName}` — same keys,
 * same parser, so what this gate sees and what the renderer resolves cannot disagree.
 *
 * `scanEmbedMarkers`'s `rejected` list is deliberately NOT treated as "a reference I might have
 * missed" here, unlike in `entry-refs/extractor.ts` where it is the loudest failure in the file.
 * The difference is what each index is for: safe-delete's where-used check must be conservative
 * because a dropped row lets a delete proceed, whereas this gate only has to match what a visitor
 * can actually FETCH. A rejected marker resolves to nothing — `scanHtmlEmbeds` iterates `markers`
 * only, and `substituteHtmlEmbeds` cannot see a rejected one either, so its authored markup
 * survives verbatim into the page and no asset is ever served through it. It is an inert
 * reference, not a hidden one, so counting it would deny live assets to buy no security.
 *
 * @complexity O(n) over `bodyHtml`'s length (one shared regex scan), plus O(k) over the markers found.
 */
function addHtmlEmbedAssetIds({ bodyHtml, out }: { bodyHtml: string; out: Set<string> }, _optional = {}): void {
  // The same untruncated marker scan now includes compound media, raw tokens and content overlays.
  for (const key of collectReferencedMediaKeys({ state: { bodyHtml } })) out.add(key);
}

/** Every asset id one entry references, across BOTH body columns, plus whether this scan knows how
 *  to read the entry's body at all. Both columns are always walked rather than switching on
 *  `bodyFormat`: a `"doc"` row's `bodyHtml` is `null` and an `"html"` row's `bodyJson` is empty, so
 *  the unused half costs nothing, and a row that somehow carries both is fully covered instead of
 *  half-scanned. */
interface EntryAssetScan {
  readonly ids: Set<string>;
  readonly readable: boolean;
}

function scanEntryAssets(entry: PostRecord, savedWidgets?: ReadonlyMap<string, Record<string, unknown>>): EntryAssetScan {
  const ids = new Set<string>();
  collectMediaRefAssetIds({ root: entry.bodyJson, out: ids });
  if (entry.bodyHtml !== null) addHtmlEmbedAssetIds({ bodyHtml: entry.bodyHtml, out: ids });
  // Featured image (2026-10-05): a gated post's header image is gated with it, same as a body image.
  if (entry.featuredMediaId) ids.add(entry.featuredMediaId);
  const widgets = collectPlacedWidgetMediaKeys({ bodyJson: entry.bodyJson, bodyHtml: entry.bodyHtml, ...(savedWidgets === undefined ? {} : { savedWidgets }) });
  for (const key of widgets.keys) ids.add(key);
  return { ids, readable: READABLE_BODY_FORMATS.has(entry.bodyFormat) && widgets.readable };
}

/**
 * Whether this entry's own gating is still a live statement about who may read its media.
 *
 * A PUBLISHED, non-trashed entry always is. A non-published one counts only when it is GATED —
 * the 2026-09-05 fix for "unpublishing a gated post releases its media."
 *
 * The pre-existing rule was `status === "published"` alone, defended for a never-published draft:
 * a draft's content is not public any other way, so excluding it opens no leak. That reasoning does
 * not survive the takedown case. A members-only post that was live and is then reverted to draft
 * has an asset URL its former readers already know; dropping it from this scan flipped that asset
 * from `private, no-store` to `public, max-age=31536000, immutable` — the takedown not only failed,
 * it handed the "removed" bytes to a shared CDN for a year.
 *
 * Keeping a GATED draft as a referrer costs nothing the old rule protected. The admin composer,
 * which `MediaRenditionRouteDeps`'s own doc cites as the reason drafts stay reachable, does not use
 * this route at all — `apps/admin/src/lib/media-image-extension.tsx` resolves editor previews
 * through `api.mediaOriginalUrl(assetId)`, the AUTHENTICATED admin route, precisely because "the
 * editor is itself an authenticated admin surface, unlike the public render path." A PUBLIC draft
 * is still skipped, so a freshly uploaded or draft-only public asset stays reachable exactly as
 * before.
 *
 * TRASHED entries stay excluded, unchanged: `a5c9bac8` (same day) established that a trashed post's
 * stale reference must not gate an asset, and this pass does not reopen that decision.
 */
function isLiveReferrerCandidate({ entry, deps }: { entry: PostRecord; deps: Parameters<typeof createRenditionAccess>[0] }): boolean {
  if (isTrashed(entry)) return false;
  return entry.status === "published" || isGatedEntry({ entry, deps });
}

/** Index each live entry once per workspace snapshot, sharing one access record across all
 * aliases so a post mentioned by id and slug cannot be double-counted. Unreadable gated bodies
 * remain fail-closed for assets they do not explicitly reference. */
function indexEntryAssets({ index, entry, deps }: { index: AssetReferenceIndex; entry: PostRecord; deps: Parameters<typeof createRenditionAccess>[0] }, { savedWidgets }: { savedWidgets?: ReadonlyMap<string, Record<string, unknown>> } = {}): void {
  if (!isLiveReferrerCandidate({ entry, deps })) return;
  const scan = scanEntryAssets(entry, savedWidgets);
  const access: AccessEvidencePost = typeof entry.memberAccessJson === "string" || entry.memberAccessJson === null ? { memberAccessJson: entry.memberAccessJson } : {};
  for (const key of scan.ids) {
    let references = index.byAsset.get(key);
    if (!references) { references = new Set(); index.byAsset.set(key, references); }
    references.add(access);
  }
  if (!scan.readable && isGatedEntry({ entry, deps })) index.opaqueGated.add(access);
}

/**
 * Indexes every live entry (post OR page, `"doc"` OR `"html"`) by the assets it embeds — the derivation
 * this route uses in place of a hand-maintained asset->entry foreign key. There is no such column
 * anywhere in this codebase (`MediaRecord`, `@jini-ai/cms/media`, carries no post/owner reference at
 * all); deriving the relationship from the one place it's actually authored (an entry's own body) is
 * the same choice `resolveMediaAssetMetadataForRender` (`pages.ts`) already made for the unrelated
 * width/height/class override lookup, rather than adding a second, independently-writable copy of
 * the same fact.
 *
 * `postRepo.list` needs no `kind` handling: it is kind-BLIND by contract and by both adapters
 * (`repo.sqlite.ts:98` selects on `workspaceId` alone), so Pages have always come back from it
 * alongside posts. The axis that actually hid content from this scan was `bodyFormat`, not `kind`.
 *
 * @complexity O(p + r) over entries p and references r, once per workspace snapshot (no
 * additional I/O per entry) — the same `postRepo.list` + linear scan shape `buildSitemap`'s
 * `computeSitemapEntries` and `pages.ts`'s `filterVisiblePosts` already use at this codebase's
 * disclosed single-workspace scale.
 */
async function buildAssetReferenceIndex(deps: Parameters<typeof createRenditionAccess>[0]): Promise<AssetReferenceIndex> {
  const entries = await deps.readEntries({ workspaceId: deps.workspaceId });
  const savedWidgets = await loadSavedWidgetConfigs(deps, entries);
  const index: AssetReferenceIndex = { byAsset: new Map(), opaqueGated: new Set() };
  for (const entry of entries) indexEntryAssets({ index, entry, deps }, savedWidgets === undefined ? {} : { savedWidgets });
  return index;
}

/** One shared reverse index per workspace per sixty seconds, invalidated by post/widget writes.
 * A cold/expired workspace rebuild lists posts once; distinct asset misses only query the index.
 * Failed reads are not retained. Session checks below still run for every gated request.
 * @complexity O(p + r) per workspace refresh; no source bodies retained in the cache. */
async function cachedReferenceIndex(deps: Parameters<typeof createRenditionAccess>[0]): Promise<AssetReferenceIndex> {
  const cache = deps.cache;
  const key = deps.workspaceId;
  const now = deps.nowMs({});
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = buildAssetReferenceIndex(deps);
  cache.set(key, { expiresAt: now + 60_000, value });
  try { return await value; }
  catch (error) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  }
}

/** Alias lookups share a record Set: unreadable referrers are not also counted as opaque gates.
 * @complexity O(a + r + o), aliases a, matching references r and opaque gated entries o; no I/O. */
async function cachedAssetReferences(deps: Parameters<typeof createRenditionAccess>[0], aliases: ReadonlySet<string>): Promise<AssetReferenceScan> {
  const index = await cachedReferenceIndex(deps);
  const referencing = new Set<Pick<PostRecord, "memberAccessJson">>();
  for (const alias of aliases) {
    for (const access of index.byAsset.get(alias) ?? []) referencing.add(access);
  }
  return { referencing: [...referencing], opaqueGated: [...index.opaqueGated].filter(access => !referencing.has(access)) };
}

type SavedWidgetRow = { id: string; slug: string; fieldsJson: unknown; deletedAt?: string | null };

/** Indexes one saved widget's config under both its id and its slug, when it is live and active. */
function addActiveWidgetConfig({ savedWidgets, row }: { savedWidgets: Map<string, Record<string, unknown>>; row: SavedWidgetRow }, _optional = {}): void {
  if ((row as typeof row & { deletedAt?: string | null }).deletedAt != null) return;
  try {
    const payload = parseWidgetInstancePayload({ fieldsJson: row.fieldsJson });
    if (payload.status !== 'active') return;
    savedWidgets.set(row.id, payload.config);
    savedWidgets.set(row.slug, payload.config);
  } catch { /* Malformed widgets do not render; they cannot serve an asset. */ }
}

/** Saved widget configs (by id and slug), loaded only when an entry repo exists AND some live
 *  entry places a widget whose media this scan cannot read from the entry body alone; otherwise
 *  `undefined`, so {@link scanEntryAssets} never pays for the widget listing.
 *  @complexity O(p) over entries plus O(w) over the workspace's saved widgets. */
async function loadSavedWidgetConfigs(
  deps: Parameters<typeof createRenditionAccess>[0],
  entries: readonly PostRecord[]
): Promise<Map<string, Record<string, unknown>> | undefined> {
  const needsWidgets = entries.some(entry => isLiveReferrerCandidate({ entry, deps }) && !collectPlacedWidgetMediaKeys({ bodyJson: entry.bodyJson, bodyHtml: entry.bodyHtml }).readable);
  if (!deps.readWidgetRows || !needsWidgets) return undefined;
  const savedWidgets = new Map<string, Record<string, unknown>>();
  for (const row of await deps.readWidgetRows({ workspaceId: deps.workspaceId })) addActiveWidgetConfig({ savedWidgets, row });
  return savedWidgets;
}

/** {@link resolveAssetAliases}'s result: the full alias set to gate on, plus the resolved record
 *  itself (or `null` for an unknown identifier). The rendition writer also uses the record for
 *  its source guard and validator without another lookup. */
interface AssetAliasResolution {
  readonly aliases: ReadonlySet<string>;
  readonly media: MediaRecord | null;
}

/**
 * Every spelling of the SAME asset that could appear either in a request URL or in an entry's
 * authored body — its opaque `id`, its CURRENT editable `slug` (2026-09-07 fix for the audit's
 * claim #2), and every slug it used to have before a rename (`listRetiredSlugs`, readable-slugs
 * plan S2a/S2b).
 *
 * THE BUG THIS CLOSES (id/slug half): both public routes here gate on the RAW `:assetId` path
 * segment, while the byte lookups they guard (`resolveMediaRendition`, `lookupMediaOriginalBlob`)
 * both went through `findMediaByIdOrSlug` the moment media gained an editable slug. So the two
 * halves keyed off different identifiers, and the reference scan simply missed — in BOTH directions:
 *   - a members-only entry embedding an asset BY ID was served anonymously through `/m/{slug}/…`
 *     (no entry body contains the slug, so `gating.length === 0` and the route allowed);
 *   - an entry embedding BY SLUG was served anonymously through `/m/{id}/…`, which is precisely
 *     the URL `render.ts`'s `renderImageTag`/`renderVideoTag` emit for it (they always template the
 *     RESOLVED record's `id`), i.e. the spelling every visitor's browser actually requests.
 * Resolving the request's identifier to a record FIRST, then gating on the full alias set, is what
 * makes the gate and the lookup agree by construction rather than by two call sites happening to
 * spell the same asset the same way.
 *
 * THE SAME GAP REOPENS ON RENAME (retired-slug half, S2b): once a slug can be renamed and an old
 * slug URL still resolves (`findBySlug`'s history fallback), an entry authored against the OLD
 * spelling is a real, live reference — dropping it from the alias set the moment the slug changes
 * would silently un-gate that entry's media, the same failure shape as the id/slug split above.
 *
 * Falls back to the raw value when nothing resolves: that request is a guaranteed 404 from the byte
 * lookup anyway, and inventing an empty alias set here would make an unknown asset take the
 * "nothing references it, allow" path for no benefit.
 *
 * @complexity O(1) — the two indexed lookups `findMediaByIdOrSlug` already performs, plus one more
 * indexed lookup for `listRetiredSlugs`.
 */
async function resolveAssetAliases({ deps, idOrSlug }: { deps: Parameters<typeof createRenditionAccess>[0]; idOrSlug: string }, _optional = {}): Promise<AssetAliasResolution> {
  const media = await deps.findMedia({ workspaceId: deps.workspaceId, idOrSlug });
  if (!media) {
    return { aliases: new Set([idOrSlug]), media: null };
  }
  const retiredSlugs = await deps.readRetiredSlugs({ workspaceId: deps.workspaceId, mediaId: media.id });
  const aliases = new Set([media.id, ...retiredSlugs]);
  if (media.slug) aliases.add(media.slug);
  return { aliases, media };
}

/**
 * Whether `assetId` is gated at all, and — if it is — whether THIS request's caller may read it.
 *
 * `gated: false` ("no need to consult who's asking, always allow") covers TWO cases: no live entry
 * references this asset and none was unreadable (freshly uploaded, only in a public draft, or a
 * legacy/unreferenced asset — nothing to gate on), and an asset referenced by at least one
 * `visibility: "public"` entry.
 * The second case matters for mixed-visibility embeds: `decidePublicAccess` (`access-resolver.ts`)
 * never consults `context` at all, so if even ONE referencing post is public, the outcome is
 * identical for every visitor regardless of session — exactly the property that makes the
 * route's ordinary long-lived, shared-cacheable response safe, and checking it FIRST also skips
 * the session/subscription/tier repo round trip entirely for the common "referenced by an ordinary
 * public post" case.
 *
 * `gated: true` (every referencing post requires SOME entitlement check) allows if the caller may
 * read ANY ONE of them — most-permissive-of-referrers when the same asset is embedded in posts of
 * mixed gated visibility (e.g. both `members` and `paid`). That is a deliberate choice, not an
 * oversight: if a post the caller CAN read embeds this exact asset, the bytes are already reachable
 * to them through that post's own rendered page, so denying the direct asset URL would only break
 * that post's own display for an entitled visitor without hiding anything from anyone the gate was
 * meant to stop.
 *
 * THE UNREADABLE-BODY FALLBACK (2026-09-05) is what stops this default from failing open again.
 * "No referrer found" is only a safe reason to allow while the scan can actually READ every entry
 * it looked at — that assumption is precisely what broke here: `bodyHtml` was never scanned, so
 * every gated `"html"` Page reported "no reference" and every one of its embeds was served to
 * anyone. So when {@link scanEntriesForAsset} reports a live, GATED entry whose body format this
 * scan does not know how to read at all ({@link READABLE_BODY_FORMATS}), those entries become the
 * gating set instead of the empty one, and the caller must satisfy at least one of them. A future
 * third body format therefore denies anonymous access to gated content's media until this scan
 * learns to read it, rather than silently publishing it — which is precisely how this defect
 * arrived, one content type at a time.
 *
 * Deliberately NOT a blanket "deny whenever nothing references this asset": that would be safe only
 * if entry bodies were the sole legitimate producer of a `/m/` URL, and they are not. Measured
 * counter-examples on this route: `Jini/packages/cms/src/seo/seo.ts`'s `resolveShareImages` turns `settings.defaultOgImage`
 * and an entry's own `seoExtJson.ogImage`/`twitterImage` into `/m/{assetId}/…` URLs fetched by
 * anonymous social crawlers, and `resolver-service.ts`'s media resolver resolves a `"media"` marker
 * authored in a THEME template (documented in the theme-authoring guide; zero occurrences across
 * the shipped themes today, but the grammar allows it). Neither is visible to `postRepo`, so a
 * blanket flip would 404 a site's share cards and any theme-authored media. Those need explicit
 * allow paths before the default can flip the rest of the way — see this route's handoff.
 *
 * @complexity O(p) — see {@link scanEntriesForAsset}; `decide` itself is pure O(1) per gating entry.
 */
async function resolveMediaAccessDecision({ deps, idOrSlug, readEntitlement }: Parameters<RenditionAccess["decide"]>[0] & { deps: Parameters<typeof createRenditionAccess>[0] }, _optional = {}): Promise<{ gated: boolean; allowed: boolean; record: MediaRecord | null }> {
  const { aliases, media } = await resolveAssetAliases({ deps, idOrSlug });
  // Documents and submitted files are private even when their id/slug is guessed or embedded in published content.
  if (media?.kind === "document" || media?.source.private) return { gated: true, allowed: false, record: media };
  const { referencing, opaqueGated } = await cachedAssetReferences(deps, aliases);
  if (referencing.some((entry) => !isGatedEntry({ entry, deps }))) {
    return { gated: false, allowed: true, record: media };
  }

  // A real referrer always wins over the fallback: once the scan has actually FOUND the entries
  // that embed this asset, an unrelated unreadable entry has no say in who may read it.
  const gating = referencing.length > 0 ? referencing : opaqueGated;
  if (gating.length === 0) {
    return { gated: false, allowed: true, record: media };
  }

  const entitlement = await readEntitlement({});
  const allowed = gating.some(entry => entitlement({ entry }));
  return { gated: true, allowed, record: media };
}


