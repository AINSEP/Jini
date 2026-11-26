import { type PublicPostRecord as PostRecord, PostNotFoundError } from '../../../../../posts/post.js';
import { injectExtraHeadIntoStaticPage } from '../../../../../presentation/html.js';

/** {@link resolveMarketingPageOrOverride}'s outcome — `"responded"` means the caller must send
 *  nothing further (the themed marketing page already went out), `"overridingPost"` means a real
 *  Post row at this slug won the slug collision and should render as a normal post, and
 *  `"fallthrough"` means neither applies and the caller should resolve `post` the ordinary way. */
type MarketingPageResolution =
  | { kind: "responded"; html: string }
  | { kind: "overridingPost"; post: PostRecord }
  | { kind: "fallthrough" };

/**
 * Resolves a `GET /:slug` request against a static theme's own fixed marketing pages, handling
 * the slug-collision policy between a theme page and a real Post row at the same slug.
 *
 * Slug-collision override (2026-08-10, default flipped to post-wins 2026-08-15) — one of the
 * two resources at this slug must win. `overridesThemePage` is tri-state (see
 * `PostRecord.overridesThemePage`'s own doc, `features/post/post.ts`): `null`/absent means the
 * author never had an opinion, in which case THIS is the one place the current default policy
 * is allowed to live — post wins. `false` is a permanent explicit choice (made via the admin
 * UI's collision warning) that keeps the theme page winning regardless of the default; `true`
 * is the same explicit choice in the post's favor, which was already the pre-2026-08-15
 * behavior and needs no special case here. Flipping the default again later is this one
 * comparison changing, never a migration — that is the entire reason the column is nullable
 * instead of `NOT NULL DEFAULT`. Checked with its own lookup here, swallowing
 * `PostNotFoundError` locally rather than letting it reach the outer catch — "no post at this
 * slug" is the overwhelmingly common case for a marketing-page route and must NOT 404 the theme
 * page that's about to render fine.
 */
export async function resolveMarketingPageOrOverride({ theme, slug, isStandaloneThemePage, readPost, finishStaticTierDocument, postPublicPath, resolveSiteTitleForRender, buildExtraHead, injectSiteAssistantIntoStaticPage }: {
  theme: { manifest: { tier: string }; pages: Readonly<Record<string, string>> } | null;
  slug: string;
  isStandaloneThemePage: (required: { pageId: string }) => boolean;
  readPost: () => Promise<{ post: PostRecord }>;
  finishStaticTierDocument: (required: { pageId: string; html: string; currentPath: string }) => Promise<string | undefined>;
  postPublicPath: (required: { slug: string }) => string;
  resolveSiteTitleForRender: (optional?: { preserveAuthoredFallback: true }) => Promise<string | undefined>;
  buildExtraHead: (required: { siteTitle: string | undefined }, optional: { canonicalFallbackPath: string }) => Promise<string>;
  injectSiteAssistantIntoStaticPage: (required: { html: string }) => string;
}, _optional = {}): Promise<MarketingPageResolution> {
  // A marketing page IS a theme file (`theme.pages[slug]`). With no theme there is no file, so this
  // can only fall through — to the ordinary post/page lookup, or to the bare 404. This is the one
  // place the product constraint bites: on a `static`-tier site, turning the theme off takes the
  // theme's own `/pricing`, `/docs` and themed 404 offline until a theme is turned back on. Nothing
  // is destroyed and reactivating restores every URL.
  //
  // A theme page NOT in `theme.pages` at all is unreachable in practice — `isMarketingPageSlug`
  // already confirms `slug` is a standalone theme page — but `theme.pages` is typed as a partial
  // record, so the lookup stays an explicit fallthrough rather than a non-null assertion, same
  // defensive shape the pre-existing `renderStaticPage` return-value check had. It is read in this
  // same guard (before the post lookup, not after it) so it is not a separate branch no request can
  // reach: `theme.pages` is never mutated in place, so reading it earlier changes nothing.
  const pageHtml = theme?.pages[slug];
  if (theme === null || pageHtml === undefined || !(theme.manifest.tier === "static" && isStandaloneThemePage({ pageId: slug }))) return { kind: "fallthrough" };

  const candidate = await readPost().catch((err) => {
    if (err instanceof PostNotFoundError) return null;
    throw err;
  });
  if (candidate && candidate.post.overridesThemePage !== false) {
    return { kind: "overridingPost", post: candidate.post };
  }

  // D2's single static-tier pipeline (E3, 2026-09-23) — `finishStaticTierDocument` runs the SAME
  // expand-partials / resolve-embeds / resolve-post-previews / render sequence every other
  // static-tier surface now runs, so a widget/media/post/content marker on this marketing page or
  // inside a partial it references — never resolved here before this fix — resolves too.
  const staticHtml = await finishStaticTierDocument({ pageId: slug, html: pageHtml, currentPath: postPublicPath({ slug: slug }) });

  if (!staticHtml) return { kind: "fallthrough" };

  // SPEC-008 T045 gap fix, part 2 (2026-08-19) — this branch renders a theme's own marketing
  // page directly via `renderStaticPage`, the same `pageShell`-bypassing shape the static-tier
  // home route already had `injectExtraHeadIntoStaticPage` wired for in `9e7786b9`; this call
  // site was the one flagged there and left unfixed. No backing `post`, so `buildExtraHead`'s
  // `"page"` mode (entry-less, same shape as `"home"`) with this page's own `/${slug}` as the
  // canonical fallback — never home's `"/"`.
  const extraHead = await buildExtraHead({ siteTitle: await resolveSiteTitleForRender() }, { canonicalFallbackPath: postPublicPath({ slug: slug }) });
  // The display-name fallback must not displace an authored theme title. If the explicit-title
  // read fails, retain the existing fold-wins behavior rather than failing the page render.
  const preserveThemeTitle = await resolveSiteTitleForRender({ preserveAuthoredFallback: true })
    .then((title) => title === undefined, () => false);
  // ADR-054 gap fix — same `pageShell`-bypassing shape missed the visitor-chat widget the same way
  // it missed `extraHead` above; a static theme's marketing pages (pricing/docs/blog/…) never showed
  // the widget even with the setting on, because `pageShell`'s own injection never ran here.
  const html = injectSiteAssistantIntoStaticPage({ html: injectExtraHeadIntoStaticPage({ html: staticHtml, extraHead }, { preserveThemeTitle }) });
  return { kind: "responded", html };
}

/** Resolves the `post` a `GET /:slug` request renders: the slug-collision winner from
 *  {@link resolveMarketingPageOrOverride} when there is one, otherwise the ordinary published-post
 *  lookup at this slug (which throws `PostNotFoundError`, caught by the route's own outer catch,
 *  when nothing exists there either). Never called with a `"responded"` resolution — that case
 *  already sent its own response and returns from the route handler before this would run. */
export async function resolvePostAfterMarketingCheck({ readPost, marketingResolution }: {
  readPost: () => Promise<{ post: PostRecord }>;
  marketingResolution: Exclude<MarketingPageResolution, { kind: "responded" }>;
}, _optional = {}): Promise<PostRecord> {
  if (marketingResolution.kind === "overridingPost") return marketingResolution.post;
  const { post } = await readPost();
  return post;
}
