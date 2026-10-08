import type { JsonValue } from "@jini-ai/core/primitives";
import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import type { SeoPostRecord as PostRecord, SeoPostReadPort, SeoSettingsReaderPort, SeoUrlsPort, SeoLivenessPort } from "./ports.js";
import { resolveWorkspaceOrigin, toAbsoluteUrl } from "./absolute-url.js";
import { SeoEntryNotFoundError } from "./errors.js";
import { resolveSeoImageRef, type ResolveSeoImageRefDeps } from "./media.js";
/** Featured image (2026-10-05) as a share-image ref: the core "public" transform every `/m/` URL
 *  already serves (`deps.ts`'s ADR-027 §4 registration). */
function featuredImageRef(post: PostRecord): string | undefined {
  return post.featuredMediaId ? `${post.featuredMediaId}:public` : undefined;
}
import type { OpenGraphType, SeoAnalysis, SeoExtFields, SeoIssue, SeoMeta } from "./types.js";

/**
 * @file `getEntryMeta`/`analyzeEntry` (ADR-PIPE-008 Decision, C-001/C-002) —
 * the pure effective-meta evaluator, per-field precedence (behavior.spec.md
 * §1.1): override ▸ site default ▸ derived. Consumed by the
 * admin preview, the public render (via `page-head-contributor.ts`), and
 * `analyzeEntry` — the one evaluator, no back door (INV-09). Never writes
 * anything — reads only, via injected deps.
 * The public home render supplies its configured site title as a fallback below explicit SEO
 * overrides; consumers without that render context retain the entry-title template.
 */

export const SEO_NAMESPACE = "site.seo";

/** Content-type -> JSON-LD `@type` map (behavior.spec.md §1.1/§3; REQ-07). */
const CONTENT_TYPE_SCHEMA_MAP: Record<PostRecord["kind"], string> = {
  post: "Article",
  page: "WebPage",
};

function isJsonObjectLike(value: unknown): value is { type?: unknown; text?: unknown; content?: unknown[] } {
  return typeof value === "object" && value !== null;
}

/** Plain-text extraction over a TipTap/ProseMirror-style doc (for the derived-excerpt fallback). */
function extractPlainText(node: unknown): string {
  if (!isJsonObjectLike(node)) return "";
  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  if (Array.isArray(node.content)) {
    for (const child of node.content) parts.push(extractPlainText(child));
  }
  return parts.join(" ");
}

const EXCERPT_MAX_LENGTH = 160;

/** override > site default > derived excerpt (behavior.spec.md §1.1). Derivation reads whichever
 *  body column `bodyFormat` says is live — `bodyJson` (TipTap doc) or `bodyHtml` (bespoke-HTML
 *  Page, SPEC-047/ADR-056 Decision 3) — so an html-format Page gets a real excerpt instead of
 *  silently resolving to `undefined`. Exported for the RSS feed (`feed.ts`), whose item description
 *  is the post's own excerpt, never the site-wide default. */
export function deriveExcerpt(required: { post: PostRecord; postRepo: Pick<SeoPostReadPort, "extractPlainText"> }, _optional: Record<string, never> = {}): string | undefined {
  const { post, postRepo } = required;
  const rawText = post.bodyFormat === "html" ? postRepo.extractPlainText({ html: post.bodyHtml ?? "" }) : extractPlainText(post.bodyJson);
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > EXCERPT_MAX_LENGTH ? `${text.slice(0, EXCERPT_MAX_LENGTH).trim()}…` : text;
}

function parseOverrides(post: PostRecord): SeoExtFields {
  if (!post.seoExtJson) return {};
  try {
    return JSON.parse(post.seoExtJson) as SeoExtFields;
  } catch {
    return {};
  }
}

/**
 * behavior.spec.md §1.1's `robots.noindex` row needs to know whether the
 * workspace's `default_robots_noindex` was EXPLICITLY configured (site
 * default present) vs. still resting on the ledger's own schema default
 * (site default effectively absent) — `getSeoSettings` alone can't
 * distinguish these (it only returns the resolved value, per
 * `settings.ts`'s doc comment), so this reads the raw `getEffective`
 * `sourceLayer` directly. Only `noindex` needs this: `nofollow`'s derived
 * and default outcomes are identical (`false`), so no test/behavior depends
 * on distinguishing them there.
 */
export interface GetEntryMetaDeps {
  postRepo: SeoPostReadPort;
  settings: SeoSettingsReaderPort;
  media: ResolveSeoImageRefDeps;
  originRegistry: OriginRegistryPort;
  runtimeMode: string;
  urls: SeoUrlsPort;
  liveness: SeoLivenessPort;
  clock: { nowIso(): string };
}

export interface GetEntryMetaInput {
  workspaceId: string;
  entryId: string;
  /** Public home render only: configured site title, below an explicit SEO title and above the page-title template. */
  homeTitle?: string | undefined;
}

type ResolvedSeoSettings = Awaited<ReturnType<SeoSettingsReaderPort["getSeoSettings"]>>;

/** canonical: override (accepted cross-domain as-is, EC-10) > routing-resolved > bare path — then
 *  joined onto the workspace's verified origin ({@link toAbsoluteUrl}) so the result is always an
 *  absolute URL. A relative override (an author who typed `/pricing` rather than a full URL) is
 *  absolutized the same way; an already-absolute override (the intended EC-10 case) passes through
 *  {@link toAbsoluteUrl} unchanged. No local origin is ever invented (INV-07's real intent — the
 *  origin comes only from `OriginRegistryPort`, never a guess): with no verified origin registered
 *  yet, `origin` is `undefined` and this degrades to the bare relative path, same as before this
 *  fix existed. */
async function resolveCanonical(
  deps: GetEntryMetaDeps,
  post: PostRecord,
  overrides: SeoExtFields,
  workspaceId: string,
  origin: VerifiedOrigin | undefined
): Promise<string> {
  const routed = await deps.urls.urlFor({
    target: { kind: "entryRef", entryId: post.id, contentType: post.kind },
    ctx: { workspaceId },
  });
  return toAbsoluteUrl({ origin, path: overrides.canonical ?? routed?.canonicalUrl ?? deps.urls.postPublicPath({ slug: post.slug }) });
}

/** robots: override > site default > derived (draft-safety fallback for noindex, EC-11). */
async function resolveRobots(
  deps: GetEntryMetaDeps,
  post: PostRecord,
  overrides: SeoExtFields,
  settings: ResolvedSeoSettings,
  workspaceId: string
): Promise<{ noindex: boolean; nofollow: boolean }> {
  let noindex: boolean;
  if (overrides.noindex !== undefined) {
    noindex = overrides.noindex;
  } else if (await deps.settings.isDefaultRobotsNoindexExplicitlySet({ workspaceId })) {
    noindex = settings.defaultRobots.noindex;
  } else {
    // 2026-09-05 fix: `softDelete` (post.ts) stamps only `deletedAt`/`updatedAt`/`version` — it
    // never clears `status`, so a post that was `published` when trashed stays `status:
    // "published"` forever and the status check alone can't catch it. `postRepo.findById` (this
    // function's own read, above) is documented trash-BLIND, so this derived fallback must check
    // `isTrashed` itself, same as `computeIndexableEntries` (sitemap.ts) and
    // `scanEntriesForAsset` (media-rendition.ts) already do at their own read
    // boundaries. `getEntryMeta` is "the one evaluator, no back door" for admin preview, public
    // render, and `analyzeEntry` alike (this file's header) — a trashed entry must resolve
    // noindex:true through every one of those consumers, not just the ones that happen to gate
    // trash upstream before calling in.
    // Scheduled publishing (2026-10-05): a not-yet-live scheduled row is noindex like a draft.
    noindex = post.status !== "published" || deps.postRepo.isTrashed({ post }) || deps.liveness.isScheduledAt({ post, nowIso: deps.clock.nowIso() });
  }
  const nofollow = overrides.nofollow ?? settings.defaultRobots.nofollow ?? false;
  return { noindex, nofollow };
}

/** The first of `refs` that resolves through media, or `undefined`. @complexity O(r) resolves. */
async function firstResolvedImage(deps: GetEntryMetaDeps, workspaceId: string, refs: ReadonlyArray<string | undefined>): Promise<string | undefined> {
  for (const ref of refs) {
    const resolved = ref ? await resolveSeoImageRef({ deps: deps.media, input: { workspaceId, ref } }) : undefined;
    if (resolved) return resolved;
  }
  return undefined;
}

/** openGraph/twitter image refs resolve through media (fail-soft, EC-07), then joined onto the
 *  workspace's verified origin ({@link toAbsoluteUrl}) — `resolveSeoImageRef` returns either an
 *  already-absolute ref (passed through unchanged) or the site-relative `/m/{assetId}/...` URL
 *  contract (ADR-027 §4), which needs the same absolutizing every other SEO URL does; crawlers
 *  require `og:image` to be absolute, same as `og:url`. */
async function resolveShareImages(
  deps: GetEntryMetaDeps,
  post: PostRecord,
  overrides: SeoExtFields,
  settings: ResolvedSeoSettings,
  workspaceId: string,
  origin: VerifiedOrigin | undefined
): Promise<{ ogImage: string | undefined; twitterImage: string | undefined }> {
  // Precedence: explicit per-entry override > the entry's featured image > the site default. An
  // override is final (unresolved means no image, as before); a featured image that no longer
  // resolves (trashed, deleted) falls through to the site default rather than leaving none.
  const fallbacks = [featuredImageRef(post), settings.defaultOgImage];
  const ogImageResolved = await firstResolvedImage(deps, workspaceId, overrides.ogImage ? [overrides.ogImage] : fallbacks);
  const twitterImageResolved = await firstResolvedImage(deps, workspaceId, overrides.twitterImage ? [overrides.twitterImage] : fallbacks);
  return {
    ogImage: ogImageResolved ? toAbsoluteUrl({ origin, path: ogImageResolved }) : undefined,
    twitterImage: twitterImageResolved ? toAbsoluteUrl({ origin, path: twitterImageResolved }) : undefined,
  };
}

/** title: override, else titleTemplate applied to entry.title. description: override > site default >
 *  derived excerpt > omitted. */
function resolveTitleAndDescription(
  post: PostRecord,
  overrides: SeoExtFields,
  settings: ResolvedSeoSettings,
  postRepo: SeoPostReadPort
): { title: string; description: string | undefined } {
  // title is never empty — entry.title is itself validated non-empty at the post write
  // chokepoint, and %s substitution never drops it.
  const title = overrides.title ?? settings.titleTemplate.replaceAll("%s", post.title);
  const description = overrides.description ?? settings.defaultDescription ?? deriveExcerpt({ post, postRepo });
  return { title, description };
}

/** ogType/schemaType (REQ-07): override, else derived from the entry's content kind. */
function resolveContentTypeFields(
  post: PostRecord,
  overrides: SeoExtFields
): { ogType: OpenGraphType; schemaType: string } {
  const ogType = overrides.ogType ?? (post.kind === "page" ? "website" : "article");
  const schemaType = overrides.schemaType ?? CONTENT_TYPE_SCHEMA_MAP[post.kind];
  return { ogType, schemaType };
}

function buildOpenGraph(
  overrides: SeoExtFields,
  title: string,
  description: string | undefined,
  ogType: OpenGraphType,
  canonical: string,
  ogImage: string | undefined
): SeoMeta["openGraph"] {
  return {
    title: overrides.ogTitle ?? title,
    description: overrides.ogDescription ?? description,
    type: ogType,
    url: canonical,
    image: ogImage,
    siteName: undefined,
  };
}

function buildTwitter(
  overrides: SeoExtFields,
  title: string,
  description: string | undefined,
  twitterImage: string | undefined,
  settings: ResolvedSeoSettings
): SeoMeta["twitter"] {
  return {
    card: overrides.twitterCard ?? "summary_large_image",
    title: overrides.twitterTitle ?? title,
    description: overrides.twitterDescription ?? description,
    image: twitterImage,
    site: settings.twitterSite,
  };
}

/** JSON-LD `@type` (REQ-07) plus the headline/name field, which differs by content kind. */
function buildJsonLdEntry(post: PostRecord, schemaType: string, title: string, description: string | undefined): Record<string, JsonValue> {
  const jsonLdEntry: Record<string, JsonValue> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    ...(post.kind === "post" ? { headline: title } : { name: title }),
  };
  if (description) jsonLdEntry.description = description;
  return jsonLdEntry;
}

/**
 * Resolves the effective `SeoMeta` for one entry (override ▸ site default ▸
 * derived, per field — behavior.spec.md §1.1). Never partial.
 * The public head contributor can supply `homeTitle` for the root page; callers that omit it
 * retain the entry-title template. Explicit SEO/share-title overrides still win.
 *
 * @complexity O(1) — one post read, one settings resolution (8 bounded
 * `getEffective` reads), up to 2 media lookups, one origin lookup (2026-09-03,
 * absolute-URL fix — {@link resolveWorkspaceOrigin}).
 */
export async function getEntryMeta(required: { deps: GetEntryMetaDeps; input: GetEntryMetaInput }, _optional: Record<string, never> = {}): Promise<SeoMeta> {
  const { deps, input } = required;
  const post = await deps.postRepo.findById({ workspaceId: input.workspaceId, id: input.entryId });
  if (!post) throw new SeoEntryNotFoundError(`entry '${input.entryId}' was not found`);

  const overrides = parseOverrides(post);
  const settings = await deps.settings.getSeoSettings({ workspaceId: input.workspaceId });

  const origin = await resolveWorkspaceOrigin({ originRegistry: deps.originRegistry, workspaceId: input.workspaceId, runtimeMode: deps.runtimeMode });
  const { title: entryTitle, description } = resolveTitleAndDescription(post, overrides, settings, deps.postRepo);
  const title = overrides.title ?? input.homeTitle ?? entryTitle;
  const canonical = await resolveCanonical(deps, post, overrides, input.workspaceId, origin);
  const { noindex, nofollow } = await resolveRobots(deps, post, overrides, settings, input.workspaceId);
  const { ogImage, twitterImage } = await resolveShareImages(deps, post, overrides, settings, input.workspaceId, origin);
  const { ogType, schemaType } = resolveContentTypeFields(post, overrides);

  return {
    title,
    description,
    canonical,
    robots: { noindex, nofollow },
    openGraph: buildOpenGraph(overrides, title, description, ogType, canonical, ogImage),
    twitter: buildTwitter(overrides, title, description, twitterImage, settings),
    jsonLd: [buildJsonLdEntry(post, schemaType, title, description)],
  };
}

/** REQ-14 — SEO analysis over `getEntryMeta`'s resolved result (pure decision, no additional I/O). */
export async function analyzeEntry(
  required: { deps: GetEntryMetaDeps; input: GetEntryMetaInput },
  _optional: Record<string, never> = {}
): Promise<SeoAnalysis> {
  const { deps, input } = required;
  const resolved = await getEntryMeta({ deps, input });
  const issues: SeoIssue[] = [];

  if (!resolved.title) {
    issues.push({ code: "missing_title", severity: "error", message: "Title is missing.", field: "title" });
  }
  if (!resolved.description) {
    issues.push({
      code: "missing_description",
      severity: "warning",
      message: "Description is missing.",
      field: "description",
    });
  }

  const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20);

  return { entryId: input.entryId, score, issues, resolved };
}
