/**
 * @file SEO contract interfaces (SPEC-008, ADR-PIPE-008). Interfaces ONLY.
 *
 * ADR-006 note (rule-of-two): introduces NO new infrastructure port. Every
 * dependency `seo` needs is a typed call to an already-ported existing module
 * (`post` via `PostRepoPort`, `routing` via `urlFor`, `settings` via
 * `getEffective`/write-service, `media` via its existing read repos,
 * `identity` via `authorize()`) — plain dependency-injected function params,
 * not the ADR-032 stub's "capability handle" abstraction
 * (`SeoContentReadCap`/`SeoUrlCap`/`SeoSettingsCap`/`SeoCacheCap`/
 * `SeoPluginCaps`). Those five stub-era interfaces are dropped here (zero
 * call sites existed, ADR-PIPE-008 Context) — every real function in this
 * module (`src/seo/{seo,write-service,settings,sitemap,media}.ts`) takes its
 * dependencies the same direct-DI way every other feature module in this repo
 * does, matching the Contract Map (C-001..C-024), which never mentions a caps
 * object either. Documented here as a disclosed simplification, not a silent
 * one.
 *
 * `SitemapCollectHook` is kept (OQ-01: a real, empty, in-module registry ships
 * in v1 — Decision §7). `SeoQueryPort` is kept as the documented single read
 * surface INV-09 requires every route to go through — Code Review's
 * architecture check (T058) verifies every admin/public route calls into
 * `seo.ts`/`sitemap.ts`'s exported functions, matching this shape, rather than
 * literally constructing one object with these five methods.
 */

/**
 * @file SEO contracts (SPEC-008, ADR-PIPE-008). Interfaces only.
 *
 * Dependencies are explicit function ports. The host binds its post, routing, settings and
 * featured-image owners; SEO never constructs a second implementation of those domains.
 * `SitemapCollectHook` remains the ordered contribution seam, scoped to a service instance.
 * `SeoQueryPort` documents the single evaluator every admin/public reader consumes (INV-09).
 */
import type { JsonValue } from "@jini-ai/core/primitives";
import type { MediaRecord } from "../media/types.js";
import type { TransformDefinitionRepoPort } from "../media/ports.js";
import type {
  HeadElement, PageHeadContext, RobotsPolicy, SeoAnalysis, SeoMeta, SeoSettings,
  SitemapCollectContext, SitemapEntry,
} from "./types.js";

/** Only the post fields SEO reads. The host adapter must preserve other fields during row saves. */
export interface SeoPostRecord {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  kind: "post" | "page";
  status: string;
  bodyFormat: "doc" | "html";
  bodyJson: JsonValue;
  bodyHtml: string | null;
  updatedAt: string;
  version: number;
  seoExtJson?: string | null | undefined;
  deletedAt?: string | null | undefined;
  publishAt?: string | null | undefined;
  featuredMediaId?: string | null | undefined;
  memberAccessJson?: string | null | undefined;
}

export interface SeoPostReadPort {
  findById(required: { workspaceId: string; id: string }, optional?: Record<string, never>): Promise<SeoPostRecord | null>;
  extractPlainText(required: { html: string }, optional?: Record<string, never>): string;
  isTrashed(required: { post: SeoPostRecord }, optional?: Record<string, never>): boolean;
}

export interface SeoPostListPort extends SeoPostReadPort {
  list(required: { workspaceId: string }, optional?: Record<string, never>): Promise<readonly SeoPostRecord[]>;
}

/** Conditional row save and revision append must share one transaction, including rollback. */
export interface SeoPostWritePort extends SeoPostReadPort {
  transaction<T>(required: { fn: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  saveIfVersion(required: { record: SeoPostRecord; ifVersion: number }, optional?: Record<string, never>): Promise<{ applied: boolean }>;
  appendRevision(required: {
    postId: string; workspaceId: string; seq: number; op: "update";
    stateJson: SeoPostRecord; actorId: string; recordedAt: string;
  }, optional?: Record<string, never>): Promise<unknown>;
}

/** Settings namespace and keys remain `site.seo`; defaults and storage belong to the host. */
export interface SeoSettingsReaderPort {
  getSeoSettings(required: { workspaceId: string }, optional?: Record<string, never>): Promise<SeoSettings>;
  isDefaultRobotsNoindexExplicitlySet(required: { workspaceId: string }, optional?: Record<string, never>): Promise<boolean>;
}

export interface SeoUrlsPort {
  postPublicPath(required: { slug: string }, optional?: Record<string, never>): string;
  urlFor(required: {
    target: { kind: "entryRef"; entryId: string; contentType: "post" | "page" };
    ctx: { workspaceId: string };
  }, optional?: Record<string, never>): Promise<{ canonicalUrl: string } | null>;
}

/** Render-time scheduled publication; no background job or implicit wall clock. */
export interface SeoLivenessPort {
  isScheduledAt(required: { post: SeoPostRecord; nowIso: string }, optional?: Record<string, never>): boolean;
  isLiveAt(required: { post: SeoPostRecord; nowIso: string }, optional?: Record<string, never>): boolean;
  postDisplayDateIso(required: { post: SeoPostRecord }, optional?: Record<string, never>): string;
}

/** Existing media/post helper behavior, bound once by the composition root. */
export interface SeoFeaturedImagePort {
  findMediaByIdOrSlug(required: { workspaceId: string; idOrSlug: string }, optional?: Record<string, never>): Promise<MediaRecord | null>;
  mediaUrlKey(required: { asset: MediaRecord }, optional?: Record<string, never>): string;
  mediaPublicPath(required: {
    key: string; variant: { kind: "transform"; name: string; version: number; ext: string };
  }, optional?: Record<string, never>): string;
  resolveFeaturedImageRef(required: { workspaceId: string; ref: string }, optional?: Record<string, never>): Promise<
    { ok: true } | { ok: false; reason: string; contentType?: string }
  >;
}

export interface SeoMediaPort {
  featuredImage: SeoFeaturedImagePort;
  transformDefinitionRepo: Pick<TransformDefinitionRepoPort, "listByName">;
}

/**
 * `seo.sitemap.collect` lets other plugins/core contribute URL sets without SEO knowing their
 * routes. Ships live-but-empty in v1 (OQ-01), with no real registrant yet.
 */
export interface SitemapCollectHook {
  readonly priority: number;
  handle(ctx: SitemapCollectContext, optional?: Record<string, never>): Promise<SitemapEntry[]>;
}

/** Single read surface: evaluator, head producer and public documents share these contracts. */
export interface SeoQueryPort {
  getEntryMeta(input: { workspaceId: string; entryId: string }, optional?: Record<string, never>): Promise<SeoMeta>;
  renderHead(ctx: PageHeadContext, optional?: Record<string, never>): Promise<HeadElement[]>;
  buildSitemap(input: { workspaceId: string }, optional?: Record<string, never>): Promise<SitemapEntry[]>;
  buildRobots(input: { workspaceId: string }, optional?: Record<string, never>): Promise<RobotsPolicy>;
  analyzeEntry(input: { workspaceId: string; entryId: string }, optional?: Record<string, never>): Promise<SeoAnalysis>;
}

/** Idempotent outbox subscriptions: content changes invalidate that workspace's sitemap. */
export interface SeoEventSubscriptions {
  onSitemapInvalidated(event: { workspaceId: string }, optional?: Record<string, never>): Promise<void>;
  onEntryPublished(event: { payload: { entryId: string; contentType: string }; workspaceId: string }, optional?: Record<string, never>): Promise<void>;
  onEntryUpdated(event: { payload: { entryId: string; contentType: string }; workspaceId: string }, optional?: Record<string, never>): Promise<void>;
  onEntryUnpublished(event: { payload: { entryId: string; contentType: string }; workspaceId: string }, optional?: Record<string, never>): Promise<void>;
}
