import type { EventBusPort, OutboxPort } from "../core/index.js";
import type { UUID } from "@jini-ai/core/primitives";
import type { SeoPostRecord as PostRecord, SeoPostListPort, SeoSettingsReaderPort } from "./ports.js";
import type { OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import { resolveWorkspaceOrigin, toAbsoluteUrl } from "./absolute-url.js";
import { getEntryMeta, type GetEntryMetaDeps } from "./seo.js";
import type { RobotsPolicy, SeoMeta, SitemapEntry } from "./types.js";
import type { SeoEventSubscriptions, SitemapCollectHook } from "./ports.js";

/**
 * @file `buildSitemap`/`buildRobots`/`regenerateSitemapCache`/
 * `invalidateSitemapCache` (ADR-PIPE-008 Decision §5/§7, C-008..C-011) — a
 * cache-backed sitemap/robots build over an in-module `Map<string,string>`
 * (no new `CachePort` — none exists in this codebase and none is warranted
 * for a single workspace-keyed value, ADR-006). Never leaks non-published or
 * `noindex` entries (INV-04/05). The empty `seo.sitemap.collect` registry
 * (OQ-01) ships live-but-empty — a real seam, zero real registrants in v1.
 */

/** INV-08 — always this shape; the only file that constructs the cache key. */
function cacheKey(workspaceId: UUID): string {
  return `ws:${workspaceId}:seo:sitemap`;
}

export interface SeoSitemapDeps extends GetEntryMetaDeps {
  postRepo: SeoPostListPort;
  /**
   * Whether an anonymous, unauthenticated crawler could actually read this post — the sitemap's own
   * visibility bar. `sitemap.xml` has no per-visitor concept at all (it is a single cache-backed
   * document served identically to every requester, ADR-PIPE-008 Decision §5/§7 above), so "would
   * THIS caller be let in" collapses to the one case that matters here: would ANY anonymous caller.
   * `resolvePostMemberAccess(json).visibility === "public"` is exactly that: every other visibility
   * (`members`/`paid`/`tiers`, and the fail-closed `unknown_visibility` default for malformed JSON)
   * denies an unauthenticated `MemberContext` in `access-resolver.ts`'s own `decide()` — this is the
   * same decision restated without needing that resolver's session/subscription/tier repo ports,
   * which this cache-backed, session-blind build path has no reason to carry.
   *
   * @complexity O(1) — `resolvePostMemberAccess` is one `JSON.parse` of a small, editorial string.
   */
  isPubliclyAccessible(required: { post: PostRecord }): boolean;
}

/** One publish-eligible, indexable entry: the raw post row plus its fully-resolved `SeoMeta`
 *  (title/description/canonical/robots — everything {@link getEntryMeta} computes). */
export interface IndexableEntry {
  readonly post: PostRecord;
  readonly meta: SeoMeta;
}

/**
 * The single publish/visibility/indexability filter every public SEO document is built from
 * (INV-04/05): never a non-`published` post, never a members/paid/tiers-gated one
 * ({@link isPubliclyVisible}, ADR-030 §4), never an effective-`noindex` one. Returns the full
 * resolved `SeoMeta` per entry (not just `loc`/`lastmod`) so a consumer that needs a title or
 * description — `llms.txt` (`routes/site/llms.ts`), which `SitemapEntry` can't supply one for —
 * reads it from the same evaluator `sitemap.xml` does, instead of re-deriving a second, subtly
 * different notion of "published and indexable."
 *
 * @complexity O(n) in the workspace's post count, each with one bounded `getEntryMeta` resolution
 *   (see that function's own complexity note).
 */
export async function computeIndexableEntries(required: { deps: SeoSitemapDeps; input: { workspaceId: UUID; nowIso?: string } }, _optional: Record<string, never> = {}): Promise<IndexableEntry[]> {
  const { deps, input } = required;
  const { workspaceId } = input;
  const nowIso = input.nowIso ?? deps.clock.nowIso();
  const posts = [...(await deps.postRepo.list({ workspaceId }))].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const entries: IndexableEntry[] = [];
  for (const post of posts) {
    if (post.status !== "published") continue;
    // Scheduled publishing (2026-10-05): not in sitemap/feed/llms.txt until its go-live time.
    if (deps.liveness.isScheduledAt({ post, nowIso })) continue;
    // 2026-09-04 fix: `softDelete` (post.ts) stamps only `deletedAt`/`updatedAt`/`version` — it
    // never clears `status`, so a post that was `published` when trashed stays `status:
    // "published"` forever and the guard above alone can't catch it. `PostRepoPort.list()` is
    // documented (and deliberately kept) trash-BLIND (see `PostRecord.deletedAt`'s own doc: "every
    // trash-AWARE read filter lives in this file's own domain functions"), the same contract
    // `listAdminPosts`/`listPublishedPosts`/`listAdminPages` (post.ts) already honor with their own
    // `!isTrashed(post)` filter — this is that same filter, applied at this domain function's own
    // trash-aware read boundary rather than widening the shared repo port.
    if (deps.postRepo.isTrashed({ post })) continue;
    // ADR-030 §4 (2026-09-03 sweep): a members/paid/tiers-gated post must not advertise its
    // canonical URL or existence to crawlers here, the same way it was already excluded from the
    // ungated home-page listing (`pages.ts`'s `filterVisiblePosts`).
    if (!deps.isPubliclyAccessible({ post })) continue;
    const meta = await getEntryMeta({ deps, input: { workspaceId, entryId: post.id } });
    if (meta.robots.noindex) continue;
    entries.push({ post, meta });
  }
  return entries;
}

/**
 * REQ-09 — composes `RobotsPolicy` from `SeoSettings.robotsRules` +
 * computed `sitemapUrls` (never persisted as one shape — computed fresh at
 * read time). `sitemapUrls` is `[]` when `sitemapEnabled` is `false`.
 *
 * 2026-09-04 fix: the advertised sitemap URL is joined onto the workspace's
 * verified origin ({@link toAbsoluteUrl}, via {@link resolveWorkspaceOrigin}),
 * the same wiring `getEntryMeta`'s `canonical`/`og:url` already use (the
 * `ADR-040` origin-resolution source this doc used to say didn't exist yet —
 * `features/origin`'s `OriginRegistryPort` — landed on 2026-09-03). Google
 * ignores a relative `Sitemap:` directive, so a bare `/sitemap.xml` made the
 * sitemap undiscoverable to crawlers even though `<loc>` entries inside it
 * were already absolute. Degrades to the same bare relative path as before
 * when no verified origin is registered yet — SEO still never fabricates a
 * local origin (INV-07), consistent with `getEntryMeta`'s own fallback.
 */
export async function buildRobots(
  required: { deps: { settings: SeoSettingsReaderPort; originRegistry: OriginRegistryPort; runtimeMode: string }; input: { workspaceId: UUID } },
  _optional: Record<string, never> = {}
): Promise<RobotsPolicy> {
  const { deps, input } = required;
  const settings = await deps.settings.getSeoSettings({ workspaceId: input.workspaceId });
  const origin = await resolveWorkspaceOrigin({ originRegistry: deps.originRegistry, workspaceId: input.workspaceId, runtimeMode: deps.runtimeMode });
  return {
    rules: settings.robotsRules,
    sitemapUrls: settings.sitemapEnabled ? [toAbsoluteUrl({ origin, path: "/sitemap.xml" })] : [],
  };
}

export const SITEMAP_INVALIDATED_EVENT = "seo.sitemap_invalidated";

/** The daemon enqueues through its enqueue-only outbox; the web process owns delivery.
 * Local invalidation also prevents reads in this process from seeing the old snapshot. */
export interface SitemapInvalidationDeps {
  outbox: OutboxPort;
  bus: EventBusPort;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  dispatch(required: { outbox: OutboxPort; bus: EventBusPort; clock: { nowMs(): number } }): Promise<unknown>;
  invalidateSitemapCache(required: { workspaceId: UUID }): void | Promise<void>;
}

export async function requestSitemapInvalidation(required: {
  deps: SitemapInvalidationDeps; input: { workspaceId: UUID };
}, _optional: Record<string, never> = {}): Promise<void> {
  const { deps, input } = required;
  await deps.invalidateSitemapCache(input);
  await deps.outbox.enqueue({ id: deps.idGen.newId(), name: SITEMAP_INVALIDATED_EVENT,
    occurredAt: deps.clock.nowIso(), aggregateId: input.workspaceId, workspaceId: input.workspaceId, payload: {} });
  await deps.dispatch({ outbox: deps.outbox, bus: deps.bus, clock: { nowMs: () => Date.parse(deps.clock.nowIso()) } });
}

/** Each service owns its hooks, build generations, cache and scheduled expiry; hosts never share state accidentally. */
export function createSitemapService(required: { deps: SeoSitemapDeps }, _optional: Record<string, never> = {}) {
  const { deps } = required;
  /** Cached value is the `JSON.stringify`d `SitemapEntry[]` for that workspace. */
  const sitemapCache = new Map<string, string>();
  /** Only the most recently started build may publish into a workspace cache. */
  const sitemapBuilds = new Map<string, symbol>();
  /**
   * Scheduled publishing (2026-10-05): the earliest future `publishAt` seen when a workspace's entry
   * was built. Nothing emits an event when a scheduled post goes live (there is no job — see
   * `contracts/core/scheduled-publish.ts`), so the cached sitemap simply stops being trusted at that
   * instant and the next read rebuilds it.
   */
  const sitemapExpiry = new Map<string, string>();

  // ---------------------------------------------------------------------------
  // `seo.sitemap.collect` (OQ-01) — a real, empty, in-module ordered registry.
  // ---------------------------------------------------------------------------

  const sitemapCollectHooks: SitemapCollectHook[] = [];

  /** Registers a `seo.sitemap.collect` contributor. Live-but-empty in v1 (OQ-01) — no real registrant ships with this feature. */
  function registerSitemapCollectHook(required: { hook: SitemapCollectHook }, _optional: Record<string, never> = {}): () => void {
    const { hook } = required;
    sitemapCollectHooks.push(hook);
    return () => {
      const index = sitemapCollectHooks.indexOf(hook);
      if (index !== -1) sitemapCollectHooks.splice(index, 1);
    };
  }

  /** Test-only reset of this service's registry. */
  function resetSitemapCollectHooksForTests(_required: Record<string, never>, _optional: Record<string, never> = {}): void {
    sitemapCollectHooks.length = 0;
  }

  /** The earliest go-live instant still ahead of `nowIso`, or `undefined` when nothing is scheduled.
   *  @complexity O(n) in the workspace's post count. */
  function nextScheduledGoLive(posts: readonly PostRecord[], nowIso: string): string | undefined {
    let next: string | undefined;
    for (const post of posts) {
      if (deps.postRepo.isTrashed({ post }) || !deps.liveness.isScheduledAt({ post, nowIso })) continue;
      if (next === undefined || post.publishAt! < next) next = post.publishAt!;
    }
    return next;
  }

  /** Builds and (when still the latest build) caches one workspace's sitemap, with its expiry. */
  async function rebuildSitemapCache(workspaceId: UUID): Promise<SitemapEntry[]> {
    const key = cacheKey(workspaceId);
    const build = Symbol();
    sitemapBuilds.set(key, build);
    const nowIso = deps.clock.nowIso();
    const entries = await computeSitemapEntries(workspaceId, nowIso);
    const expiry = nextScheduledGoLive(await deps.postRepo.list({ workspaceId }), nowIso);
    if (sitemapBuilds.get(key) === build) {
      sitemapCache.set(key, JSON.stringify(entries));
      if (expiry === undefined) sitemapExpiry.delete(key);
      else sitemapExpiry.set(key, expiry);
    }
    return entries;
  }

  async function computeSitemapEntries(workspaceId: UUID, nowIso: string): Promise<SitemapEntry[]> {
    // `meta.canonical` is absolute when the workspace has a verified origin (2026-09-03 fix,
    // `getEntryMeta`'s own `resolveCanonical`) — sitemap `loc` entries are required to be absolute
    // by the sitemap protocol, same requirement `og:url` has. Falls back to the bare relative path
    // for the same disclosed no-origin degradation `getEntryMeta` documents; unchanged from before
    // this fix for a workspace with no verified origin yet.
    const entries: SitemapEntry[] = (await computeIndexableEntries({ deps, input: { workspaceId, nowIso } })).map(({ post, meta }) => ({
      loc: meta.canonical,
      lastmod: post.updatedAt,
    }));

    for (const hook of [...sitemapCollectHooks].sort((a, b) => a.priority - b.priority)) {
      const collected = await hook.handle({ workspaceId, baseUrl: "" });
      entries.push(...collected);
    }

    return entries;
  }

  /**
   * REQ-08/10 — cache-checked build of `SitemapEntry[]`. Never `null`; `[]`
   * when empty (EC-04). Never includes a non-published or effective-`noindex`
   * entry (INV-04/05).
   */
  async function buildSitemap(input: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<SitemapEntry[]> {
    const key = cacheKey(input.workspaceId);
    const cached = sitemapCache.get(key);
    const expiry = sitemapExpiry.get(key);
    const expired = expiry !== undefined && deps.clock.nowIso() >= expiry;
    if (cached !== undefined && !expired) return JSON.parse(cached) as SitemapEntry[];
    return rebuildSitemapCache(input.workspaceId);
  }

  /** REQ-13 — force-rebuilds the cache entry now, bypassing the cache-hit path. */
  async function regenerateSitemapCache(input: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<void> {
    await rebuildSitemapCache(input.workspaceId);
  }

  /** REQ-10/INV-08 — clears the workspace's cache entry. Idempotent: a repeat call on an already-clear key is a no-op. */
  function invalidateSitemapCache(input: { workspaceId: UUID }, _optional: Record<string, never> = {}): void {
    sitemapCache.delete(cacheKey(input.workspaceId));
    sitemapBuilds.delete(cacheKey(input.workspaceId));
    sitemapExpiry.delete(cacheKey(input.workspaceId));
  }

  /**
   * REQ-10 — the 3 outbox-event subscription handlers (idempotent per
   * ADR-009): any `entry.published`/`entry.updated`/`entry.unpublished`
   * delivery invalidates that workspace's sitemap cache entry. Wired to
   * `bus.subscribe` at `server/app.ts` boot (T038).
   */
  function createSeoEventSubscriptions(_required: Record<string, never>, _optional: Record<string, never> = {}): SeoEventSubscriptions {
    const handler = async (event: { payload: { entryId: UUID; contentType: string }; workspaceId: UUID }, _optional: Record<string, never> = {}) => {
      invalidateSitemapCache({ workspaceId: event.workspaceId });
    };
    return { onEntryPublished: handler, onEntryUpdated: handler, onEntryUnpublished: handler,
      onSitemapInvalidated: async (event, _optional: Record<string, never> = {}) => { invalidateSitemapCache({ workspaceId: event.workspaceId }); } };
  }

  return {
    registerSitemapCollectHook, resetSitemapCollectHooksForTests,
    buildSitemap, regenerateSitemapCache, invalidateSitemapCache, createSeoEventSubscriptions,
    computeIndexableEntries: (input: { workspaceId: UUID; nowIso?: string }, optional: Record<string, never> = {}) => computeIndexableEntries({ deps, input }, optional),
    buildRobots: (input: { workspaceId: UUID }, optional: Record<string, never> = {}) => buildRobots({ deps, input }, optional),
    requestSitemapInvalidation: (required: { deps: Omit<SitemapInvalidationDeps, "invalidateSitemapCache">; input: { workspaceId: UUID } }, optional: Record<string, never> = {}) => requestSitemapInvalidation({ deps: { ...required.deps, invalidateSitemapCache }, input: required.input }, optional),
  };
}
