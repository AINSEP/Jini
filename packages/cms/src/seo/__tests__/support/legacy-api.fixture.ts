/**
 * Test-only adapters keep the copied assertions and call sites intact while exercising the new
 * dependency-injected API. Settings and site-title staging are fakes, not module mocks or a second
 * production settings owner. Defaults below are today's test host policy, never package policy.
 */
import { afterEach } from "vitest";
import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { findMediaByIdOrSlug, isValidMediaSlugFormat } from "../../../media/index.js";
import type { MediaRepoPort, TransformDefinitionRepoPort } from "../../../media/index.js";
import type { SeoSettings, SeoExtFieldsPatch, PageHeadContext } from "../../types.js";
import type { SeoPostRecord, SeoSettingsReaderPort, SeoMediaPort, SeoPostReadPort, SeoPostWritePort } from "../../ports.js";
import { getEntryMeta as readMeta, analyzeEntry as analyze } from "../../seo.js";
import type { GetEntryMetaInput } from "../../seo.js";
import { buildFeed as readFeed, renderRssXml as renderRss } from "../../feed.js";
import type { Feed } from "../../feed.js";
import { toAbsoluteUrl as absolute, resolveWorkspaceOrigin as workspaceOrigin } from "../../absolute-url.js";
import { resolveSeoImageRef as imageRef } from "../../media.js";
import { buildHeadElements } from "../../page-head.js";
import { setEntrySeoOverrides as writeOverrides } from "../../write-service.js";
import type { SetEntrySeoOverridesDeps, SetEntrySeoOverridesInput } from "../../write-service.js";
import { buildRobots as readRobots, createSitemapService } from "../../sitemap.js";
import type { SeoSitemapDeps } from "../../sitemap.js";
import type { SitemapCollectHook } from "../../ports.js";
import { InMemoryPostRepo, ROOT_SLUG } from "./post.fixture.js";
import type { PostRepoPort } from "./post.fixture.js";
import { extractPlainTextFromHtml } from "./html-plain-text.fixture.js";

export class InMemorySettingsRepo implements SeoSettingsReaderPort {
  private values = new Map<string, Partial<SeoSettings>>();
  private explicitNoindex = new Set<string>();
  private titles = new Map<string, string>();
  async getSeoSettings({ workspaceId }: { workspaceId: string }): Promise<SeoSettings> {
    return structuredClone({ titleTemplate: "%s", defaultRobots: { noindex: false, nofollow: false },
      sitemapEnabled: true, robotsRules: [], ...this.values.get(workspaceId) });
  }
  async isDefaultRobotsNoindexExplicitlySet({ workspaceId }: { workspaceId: string }) {
    return this.explicitNoindex.has(workspaceId);
  }
  seed(workspaceId: string, patch: Partial<SeoSettings>) {
    this.values.set(workspaceId, { ...this.values.get(workspaceId), ...patch });
    if (patch.defaultRobots !== undefined) this.explicitNoindex.add(workspaceId);
  }
  seedTitle(workspaceId: string, title: string) { this.titles.set(workspaceId, title.trim()); }
  async siteTitle({ workspaceId }: { workspaceId: string }) { return this.titles.get(workspaceId); }
}

export async function ensureSeoSettingDefinitions(_deps: unknown, _input: unknown) {}
export async function ensureSiteTitleSettingDefinition(_deps: unknown, _input: unknown) {}
export const SITE_TITLE_NAMESPACE = "site";
export const SITE_TITLE_KEY = "title";
export async function setSeoSettings(deps: { settingsRepo: InMemorySettingsRepo; invalidateSitemap?: (input: { workspaceId: string }) => void | Promise<void> }, input: { workspaceId: string; callerPrincipalId: string; patch: Partial<SeoSettings> }) {
  deps.settingsRepo.seed(input.workspaceId, input.patch);
  // The host settings writer owns this effect; exercise its injected seam in the copied suite.
  await deps.invalidateSitemap?.({ workspaceId: input.workspaceId });
}
export async function set(required: { deps: { repo: InMemorySettingsRepo; clock: unknown; ids: unknown; authorize: unknown; principals: unknown }; input: { workspaceId: string; value: string; namespace: string; key: string; scope: string; callerPrincipalId: string } }) {
  required.deps.repo.seedTitle(required.input.workspaceId, required.input.value);
}

interface LegacyMedia {
  mediaRepo: MediaRepoPort;
  transformDefinitionRepo: TransformDefinitionRepoPort;
  assetRenditionRepo?: unknown;
}

/** Real Jini media repo lookup; URL formatting is the narrow host port fixture. */
export function mediaPort(deps: LegacyMedia): SeoMediaPort {
  return {
    transformDefinitionRepo: deps.transformDefinitionRepo,
    featuredImage: {
      findMediaByIdOrSlug: input => findMediaByIdOrSlug({ deps, input }),
      mediaUrlKey: ({ asset }) => asset.slug && isValidMediaSlugFormat({ slug: asset.slug }) ? asset.slug : asset.id,
      mediaPublicPath: ({ key, variant }) => `/m/${encodeURIComponent(key)}/${encodeURIComponent(variant.name)}.v${variant.version}/image.${variant.ext}`,
      // Copied suites stage image assets or misses. Known-video refusal has a separate port probe.
      resolveFeaturedImageRef: async () => ({ ok: false, reason: "not-found" }),
    },
  };
}

function postReadPort(repo: Pick<PostRepoPort, "findById">): SeoPostReadPort {
  return { findById: input => repo.findById(input), extractPlainText: ({ html }) => extractPlainTextFromHtml(html),
    isTrashed: ({ post }) => post.deletedAt != null };
}
function postWritePort(repo: PostRepoPort): SeoPostWritePort {
  return { ...postReadPort(repo), saveIfVersion: input => repo.saveIfVersion(input),
    transaction: ({ fn }) => repo.transaction(fn), appendRevision: input => repo.appendRevision(input) };
}

interface LegacyDeps {
  postRepo: Pick<PostRepoPort, "findById" | "list">;
  settingsRepo: InMemorySettingsRepo;
  media: LegacyMedia;
  originRegistry: OriginRegistryPort;
}

/** Explicit runtime mode and scheduling clock are supplied by the test host. */
export function seoDeps(deps: LegacyDeps): SeoSitemapDeps {
  const postRepo = { ...postReadPort(deps.postRepo), list: (input: { workspaceId: string }) => deps.postRepo.list(input) };
  const scheduled = (post: SeoPostRecord, nowIso: string) => post.status === "published" && typeof post.publishAt === "string" && post.publishAt > nowIso;
  const postPublicPath = ({ slug }: { slug: string }) => slug === "/" ? "/" : `/${slug}`;
  return {
    postRepo, settings: deps.settingsRepo, media: mediaPort(deps.media), originRegistry: deps.originRegistry,
    runtimeMode: process.env.TOVU_RUNTIME_MODE ?? "local", clock: { nowIso: () => new Date().toISOString() },
    urls: { postPublicPath, urlFor: async ({ target, ctx }) => {
      const row = await deps.postRepo.findById({ workspaceId: ctx.workspaceId, id: target.entryId });
      return row ? { canonicalUrl: postPublicPath(row) } : null;
    } },
    liveness: {
      isScheduledAt: ({ post, nowIso }) => scheduled(post, nowIso),
      isLiveAt: ({ post, nowIso }) => post.status === "published" && post.deletedAt == null && !scheduled(post, nowIso),
      postDisplayDateIso: ({ post }) => post.publishAt ?? post.updatedAt,
    },
    isPubliclyAccessible: ({ post }) => {
      if (post.memberAccessJson == null) return true;
      try { return JSON.parse(post.memberAccessJson).visibility === "public"; }
      catch { return false; }
    },
  };
}

export function getEntryMeta(deps: LegacyDeps, input: GetEntryMetaInput) { return readMeta({ deps: seoDeps(deps), input }); }
export function analyzeEntry(deps: LegacyDeps, input: GetEntryMetaInput) { return analyze({ deps: seoDeps(deps), input }); }
export function buildFeed(deps: LegacyDeps, input: { workspaceId: string; siteTitle: string }) { return readFeed({ deps: seoDeps(deps), input }); }
export function renderRssXml(feed: Feed) { return renderRss({ feed }); }
export function resolveSeoImageRef(deps: LegacyMedia, input: { workspaceId: string; ref: string }) { return imageRef({ deps: mediaPort(deps), input }); }
export function toAbsoluteUrl(origin: VerifiedOrigin | undefined, path: string) { return absolute({ origin, path }); }
export function resolveWorkspaceOrigin(originRegistry: OriginRegistryPort, workspaceId: string, mode: () => string = () => "local") {
  return workspaceOrigin({ originRegistry, workspaceId, runtimeMode: mode() });
}
export function buildRobots(deps: { settingsRepo: InMemorySettingsRepo; originRegistry: OriginRegistryPort }, input: { workspaceId: string }) {
  return readRobots({ deps: { settings: deps.settingsRepo, originRegistry: deps.originRegistry, runtimeMode: process.env.TOVU_RUNTIME_MODE ?? "local" }, input });
}
export function createSeoPageHeadHook(deps: LegacyDeps, priority = 100) {
  return { priority, handle: (ctx: PageHeadContext) => buildHeadElements({ deps: seoDeps(deps), ctx,
    rootSlug: ROOT_SLUG, siteTitle: input => deps.settingsRepo.siteTitle(input) }) };
}

const missingFeaturedImage: SeoMediaPort["featuredImage"] = {
  findMediaByIdOrSlug: async () => null, mediaUrlKey: ({ asset }) => asset.id,
  mediaPublicPath: () => "", resolveFeaturedImageRef: async () => ({ ok: false, reason: "not-found" }),
};
export function setEntrySeoOverrides(required: {
  deps: Omit<SetEntrySeoOverridesDeps, "postRepo" | "media"> & { postRepo: PostRepoPort; media?: LegacyMedia };
  input: SetEntrySeoOverridesInput;
}) {
  return writeOverrides({ ...required, deps: { ...required.deps, postRepo: postWritePort(required.deps.postRepo),
    media: { featuredImage: required.deps.media ? mediaPort(required.deps.media).featuredImage : missingFeaturedImage } } });
}

// Compatibility state belongs only to each copied test, never the SEO runtime. The original
// singleton call sites use these adapters; the separate factory suite exercises instances directly.
const services: Array<{ deps: LegacyDeps; service: ReturnType<typeof createSitemapService> }> = [];
const hooks: SitemapCollectHook[] = [];
function serviceFor(deps: LegacyDeps) {
  const existing = services.find(item => item.deps === deps);
  if (existing) return existing.service;
  const service = createSitemapService({ deps: seoDeps(deps) });
  for (const hook of hooks) service.registerSitemapCollectHook({ hook });
  services.push({ deps, service });
  return service;
}
export function buildSitemap(deps: LegacyDeps, input: { workspaceId: string }) { return serviceFor(deps).buildSitemap(input); }
/** Reuse the same instance's handlers so delivery invalidates the cache populated by this test. */
export function createSeoEventSubscriptions(deps: LegacyDeps) { return serviceFor(deps).createSeoEventSubscriptions({}); }
export function regenerateSitemapCache(deps: LegacyDeps, input: { workspaceId: string }) { return serviceFor(deps).regenerateSitemapCache(input); }
export function invalidateSitemapCache(input: { workspaceId: string }) { for (const item of services) item.service.invalidateSitemapCache(input); }
export function registerSitemapCollectHook(hook: SitemapCollectHook) {
  hooks.push(hook);
  for (const item of services) item.service.registerSitemapCollectHook({ hook });
}
export function resetSitemapCollectHooksForTests() { hooks.length = 0; for (const item of services) item.service.resetSitemapCollectHooksForTests({}); }
afterEach(() => { services.length = 0; hooks.length = 0; });
