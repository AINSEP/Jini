import type { DocumentAssets } from '../../../presentation/index.js';
import type { DeclaredScript } from '@jini-ai/core/contracts/site/cookie-consent';
import type { JsonValue } from '@jini-ai/core/primitives';
import type { SiteProduct, SiteRenderContext } from './render-context.js';
import type { MediaAssetRenderMeta } from '@jini-ai/core/contracts/site/cms-media';
import type { PublicPostRecord as PostRecord } from '../../../posts/post.js';
import type { ResolveHtmlPageEmbedsResult } from '../../../widgets/html/index.js';
import type { ResolvePageWidgetsResult } from '../../../widgets/index.js';
import type { AssignedTermView } from '../../../taxonomy/index.js';
import type { ResolvedNavItem as StaticMenuItem } from '../../../navigation/types.js';
import { escapeHtml } from '@jini-ai/core/text';
import { injectExtraHeadIntoStaticPage } from '../../../presentation/html.js';
import { siteHeader, siteFooter } from './render/components/layout.js';
import { EMPTY_INLINE_RESOLVED, EMPTY_MEDIA_TRANSFORM_VERSIONS, EMPTY_MEDIA_ASSET_METADATA } from './render/doc/doc-nodes.js';

/** No-terms default for every `renderSite`/`renderPostBody` caller that doesn't pass one — same
 * "optional, defaults to empty, degrades to no block" convention as {@link EMPTY_MEDIA_ASSET_METADATA}
 * immediately above. */
const EMPTY_ASSIGNED_TERMS: readonly AssignedTermView[] = [];

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/** {@link renderSite}'s `required` parameter, named so the tier-render helpers below can each take
 *  just the slice of it they need rather than repeating this whole shape — split out purely for
 *  {@link renderSite}'s own complexity, no change to the accepted call shape (an inline object type
 *  and a structurally-identical named interface are the same type to every existing caller). */
export interface RenderSiteRequired {
  renderAssets?: (required: { scripts: readonly DeclaredScript[]; static?: true }) => Promise<DocumentAssets>;
  transformBody?: (required: { html: string }) => Promise<string>;
  scripts?: readonly DeclaredScript[];
  /**
   * The resolved active theme, or `null` when the operator has deliberately turned the theme off
   * (state 3 of the optional-theme feature). `null` is NOT "the theme is broken" — that case still
   * resolves to a substitute theme in `features/theme/active-theme.ts`. It means the operator is
   * handling styling themselves, so this render must produce a complete, unstyled, VALID document
   * rather than an error: see `__tests__/render-no-theme.test.ts` for the shape it must keep.
   */
  theme: { manifest: { name: string; tier: string; scripts?: readonly DeclaredScript[] }; templates: Record<string, JsonValue>; liquidTemplates: Record<string, string>; handlebarsTemplates: Record<string, string> } | null;
  footerCredit: string;
  renderScriptAssets: (required: { scripts: readonly DeclaredScript[] }) => string;
  resolveTemplateId: (required: { route: SiteRenderContext['route']; templates: Record<string, JsonValue> }) => string | undefined;
  resolveLiquidTemplateId: (required: { route: SiteRenderContext['route']; liquidTemplates: Record<string, string> }) => string | undefined;
  resolveHandlebarsTemplateId: (required: { route: SiteRenderContext['route']; handlebarsTemplates: Record<string, string> }) => string | undefined;
  loadLiquidSandbox: () => Promise<{ renderLiquidInSandbox: (required: { source: string; ctx: SiteRenderContext }) => Promise<string> }>;
  loadHandlebarsSandbox: () => Promise<{ renderHandlebarsInSandbox: (required: { source: string; ctx: SiteRenderContext }) => Promise<string> }>;
  renderBlock: (required: { node: JsonValue; ctx: SiteRenderContext }) => string;
  renderStaticPage: (required: { theme: NonNullable<RenderSiteRequired['theme']>; pageId: string; menus: RenderSiteRequired['staticMenus'] }) => string | undefined;
  injectSiteAssistantIntoStaticPage: (required: { html: string; enabled: boolean | 'react' | 'vanilla' }) => string;
  entryContent: (ctx: SiteRenderContext) => string;
  entryList: (ctx: SiteRenderContext, props: Record<string, never>) => string;
  productEntryContent: (ctx: SiteRenderContext) => string;
  productEntryList: (ctx: SiteRenderContext) => string;
  pageShell: (required: { title: string; theme: RenderSiteRequired['theme']; body: string; extraHead: string | undefined; siteAssistantEnabled: RenderSiteRequired['siteAssistantEnabled']; documentAssets: DocumentAssets }) => string;
  route: "home" | "post" | "products" | "product";
  siteTitle: string;
  posts: PostRecord[];
  /** See {@link SiteRenderContext.listing}. */
  listing?: { pagePath: string; after: number };
  post?: PostRecord;
  /** Sample store-plugin products (products/product routes). Omitted entirely (every pre-existing
   * caller of `renderSite`) behaves as "no products" — not a breaking change, same convention as
   * `widgets` below. */
  products?: SiteProduct[];
  product?: SiteProduct;
  /**
   * SPEC-043/ADR-047 W-004 — pre-resolved widget data for this render (`resolvePageWidgets`'s own
   * output). `render.ts` stays a pure "resolved data -> HTML" renderer, matching how `posts`/`post`
   * are already pre-resolved by the caller (`routes/site/pages.ts`) rather than repo-fetched here —
   * `resolvePageWidgets` itself never throws (REQ-27), so the caller can always pass a real result.
   * Omitted entirely (every pre-existing caller/test of `renderSite`) behaves as "no regions
   * declared, no inline embeds resolved" — not a breaking change.
   */
  widgets?: ResolvePageWidgetsResult;
  /**
   * SPEC-047 Slice 2 — an `"html"`-format Page's pre-resolved `data-embed-type`
   * targets (`resolver-service.ts`'s `resolveHtmlPageEmbeds`), threaded straight into
   * `SiteRenderContext.pageHtmlEmbeds`. Omitted by every caller/test that never renders a Page with
   * embeds (including a `"doc"` post, which has no use for this at all) — see that field's own doc
   * for the safe-degrade behavior when it is missing.
   */
  pageHtmlEmbeds?: ResolveHtmlPageEmbedsResult;
  /**
   * ADR-027 §4 — the latest registered version of each transform NAME this render's image refs may
   * use, threaded straight into `SiteRenderContext.mediaTransformVersions` (see that field's own
   * doc). The caller (`routes/site/pages.ts`) resolves this from the SAME `transform_registry` the
   * public `/m/` route reads, so a version this render embeds is guaranteed servable. Omitted by
   * every caller/test that never renders a ref-based image node — degrades to an empty map, which
   * `renderDocNode`'s `image` case already treats as "not resolvable" (placeholder), not a crash.
   */
  mediaTransformVersions?: ReadonlyMap<string, number>;
  /**
   * Quick-and-dirty public-render sizing fix (owner-directed skip-the-ADR fix) — each resolved
   * image ref's width/height/CSS-class override, keyed by `assetId`, threaded straight into
   * `SiteRenderContext.mediaAssetMetadata` (see that field's own doc). The caller
   * (`routes/site/pages.ts`'s `resolveMediaAssetMetadataForRender`) resolves this from the same
   * `mediaRepo` the admin edit panel writes through. Omitted by every caller/test that never
   * renders an image ref — degrades to an empty map, which the `image` case already treats as "no
   * override" (omit the attribute), not a crash.
   */
  mediaAssetMetadata?: ReadonlyMap<string, MediaAssetRenderMeta>;
  /**
   * Taxonomy render-surface gap fix (2026-09-03) — `post`'s pre-resolved assigned category/tag terms
   * (`routes/site/pages.ts`'s `resolveAssignedTermsForRender`, over `deps.entryTermReadRepo`),
   * threaded straight into `SiteRenderContext.assignedTerms` (see that field's own doc). `render.ts`
   * stays I/O-free, same "route resolves, render renders" split every other pre-resolved field on
   * this required object already follows. Omitted by every caller/test that never renders a post
   * with assigned terms — degrades to an empty array, which {@link renderAssignedTermsBlock} already
   * treats as "nothing to render" (returns `""`), not a crash.
   */
  assignedTerms?: readonly AssignedTermView[];
  /** SPEC-008 T049 — pre-serialized `page.head` fold output, threaded through to `pageShell`. */
  extraHead?: string;
  /**
   * ADR-054 — whether to inject the public visitor-chat mount node + script (Task 2/3). Threaded
   * through unchanged to `pageShell`; see that parameter's own doc for why this defaults to `false`
   * rather than `true`. The caller (a route handler) resolves this from
   * `isPublicAssistantEnabled({ settingsRepo: deps.settingsRepo }, { workspaceId: deps.workspaceId })`
   * — `render.ts` stays a pure "resolved data -> HTML" renderer and never reads the settings ledger
   * itself, the same convention `widgets`/`posts`/`post` above already follow.
   */
  siteAssistantEnabled?: (boolean | 'react' | 'vanilla');
  /**
   * Menu-location wiring (2026-08-10) — the `header`/`footer` location menus pre-resolved by the
   * route layer (`pages.ts`'s `resolveStaticMenusForRender`, over `navigation`'s `resolveForLocation`
   * + `routing`'s `urlFor`), threaded straight into the static-tier home-route `renderStaticPage`
   * call below. `render.ts` stays I/O-free — same "route resolves, render renders" split every other
   * pre-resolved field on this required object already follows. Omitted (every non-static-tier
   * caller, and every existing test) behaves as "no menu bound to either location", i.e. each
   * static theme's own authored header/footer content renders unchanged — not a breaking change.
   */
  staticMenus?: { header?: readonly StaticMenuItem[]; footer?: readonly StaticMenuItem[] };
  /**
   * Explore's Preview tab (2026-08-12, `.liquid` template render) — when set, names the exact
   * `theme.liquidTemplates` key to render, bypassing {@link resolveLiquidTemplateId}'s own
   * route -> file preference order. That resolver exists to pick ONE file when several could satisfy
   * the same `route` (e.g. it always prefers `post` over `entry` when a theme ships both) — the wrong
   * question for Explore, which is asking "what does THIS specific file produce", not "what would the
   * live site pick for this route". Without this override, previewing `entry.liquid` in a theme that
   * also ships `post.liquid` would silently render the WRONG file with no indication to the operator.
   * Ignored for every non-`templated` tier (nothing to override) and every pre-existing caller (every
   * one of which leaves this `undefined`, so `resolveLiquidTemplateId` keeps deciding exactly as it
   * always has) — this is purely additive.
   */
  liquidTemplateIdOverride?: string;
  /** Bug D follow-up — the site's IANA zone, threaded straight into {@link SiteRenderContext.timeZone}
   *  (see that field's doc). Omitted renders UTC. */
  timeZone?: string;
}

/** {@link buildSiteRenderContext}'s widget fields: no regions and no inline widgets when the caller
 *  resolved none. Spread in place so `ctx`'s key order is unchanged. */
function siteWidgetContext(
  widgets: RenderSiteRequired["widgets"],
): Pick<SiteRenderContext, "widgetRegions" | "widgetInlineResolved"> {
  return {
    widgetRegions: widgets?.regions ?? {},
    widgetInlineResolved: widgets?.inlineResolved ?? EMPTY_INLINE_RESOLVED,
  };
}

/** {@link renderSite}'s own `ctx` construction, pulled out so the four `??`/`?.` defaulting
 *  expressions are counted once here instead of against the top-level dispatcher's budget. */
function buildSiteRenderContext(required: RenderSiteRequired): SiteRenderContext {
  return {
    siteTitle: required.siteTitle,
    route: required.route,
    posts: required.posts,
    ...(required.listing !== undefined ? { listing: required.listing } : {}),
    post: required.post,
    products: required.products ?? [],
    product: required.product,
    themeName: required.theme?.manifest.name ?? null,
    ...siteWidgetContext(required.widgets),
    mediaTransformVersions: required.mediaTransformVersions ?? EMPTY_MEDIA_TRANSFORM_VERSIONS,
    mediaAssetMetadata: required.mediaAssetMetadata ?? EMPTY_MEDIA_ASSET_METADATA,
    assignedTerms: required.assignedTerms ?? EMPTY_ASSIGNED_TERMS,
    pageHtmlEmbeds: required.pageHtmlEmbeds,
    ...(required.timeZone !== undefined ? { timeZone: required.timeZone } : {}),
  } as SiteRenderContext;
}

/**
 * A theme with no dedicated `products`/`product` template (declarative tier's own
 * `resolveTemplateId`, or a static/templated theme that never declared one — the seeded default
 * `"basic"` among them) still needs to render *something* instead of relying on a component that
 * doesn't exist (REQ-10 spirit: never a raw crash). `productEntryList`/`productEntryContent`
 * mirror `entryList`/`entryContent`'s own markup shape but read `ctx.products`/`ctx.product`
 * rather than `ctx.posts`/`ctx.post` — see those two functions' own doc for the 2026-08-12 bug
 * this replaced (both product routes used to silently fall through to the POST-shaped fallback,
 * which never reads product data at all).
 *
 * Pulled out of {@link renderSite} as a top-level function rather than a closure over `ctx`/`route`
 * (an inline closure would still be measured separately by this repo's complexity gate and so
 * wasn't the source of `renderSite`'s own violation, but keeping every extracted tier-body helper at
 * the same top-level shape — see {@link renderTemplatedTierBody} etc. — keeps this file's own
 * "extract to top-level functions, not closures" convention consistent). Deterministic and
 * side-effect-free, so calling it eagerly from each tier-render helper below (rather than only when
 * actually needed, the way the original closure was invoked lazily) produces identical output.
 */
function fallbackSiteBody(ctx: SiteRenderContext, route: SiteRenderContext["route"], required: RenderSiteRequired): string {
  let main: string;
  switch (route) {
    case "post": main = required.entryContent(ctx); break;
    case "product": main = required.productEntryContent(ctx); break;
    case "products": main = required.productEntryList(ctx); break;
    default: main = required.entryList(ctx, {});
  }
  return `${siteHeader(ctx, {})}${main}${siteFooter(ctx, { creditText: required.footerCredit })}`;
}

/**
 * Static tier: unlike every other tier, a static theme's page is already a complete
 * `<!doctype html>` document (tokens, nav, footer, scripts — all of it), not a body fragment
 * `pageShell()` still needs to wrap. Returns the full page directly, bypassing `pageShell`, when the
 * theme has one for this route; `undefined` for every other case (non-static tier, non-home route, or
 * a static theme with no `pages/index.html`), which is {@link renderSite}'s own signal to fall
 * through to the ordinary fallback-body/`pageShell` path below, same as any other unresolved route on
 * any other tier. `extraHead` still gets spliced in (SPEC-008 T045) via
 * {@link injectExtraHeadIntoStaticPage} — bypassing `pageShell` must not mean bypassing the SEO fold.
 * The ADR-054 visitor-chat widget gets the identical treatment via
 * {@link injectSiteAssistantIntoStaticPage} — bypassing `pageShell` must not mean bypassing that
 * either (this was a live bug: a static-tier home page never showed the widget even with
 * `site.assistant.public_enabled` on, since `pageShell`'s own injection never ran for this branch).
 */
async function renderStaticTierHomePage(
  { theme, route, staticMenus, extraHead, siteAssistantEnabled, renderAssets, required }: { theme: NonNullable<RenderSiteRequired['theme']>; route: SiteRenderContext["route"]; staticMenus: RenderSiteRequired["staticMenus"]; extraHead: string | undefined; siteAssistantEnabled: (boolean | 'react' | 'vanilla'); renderAssets: RenderSiteRequired['renderAssets']; required: RenderSiteRequired }, _optional = {}
): Promise<string | undefined> {
  if (theme.manifest.tier !== "static" || route !== "home") return undefined;
  const staticHtml = required.renderStaticPage({ theme, pageId: "index", menus: staticMenus });
  if (!staticHtml) return undefined;
  const assets = await renderAssets?.({ scripts: [], static: true });
  return required.injectSiteAssistantIntoStaticPage({ html: injectExtraHeadIntoStaticPage({ html: staticHtml, extraHead: (extraHead ?? '') + (assets?.head ?? '') }), enabled: siteAssistantEnabled });
}

// ---------------------------------------------------------------------------
// Templated tier (LiquidJS) — ADR-020 Tier 2.
//
// A "templated" theme ships `.liquid` files instead of JSON block trees. Liquid
// gives authors loops / conditionals / filters that the fixed-component
// declarative tier can't express — while executing NO theme JavaScript.
//
// Two seams bridge Liquid back into the trusted core:
//   • {% render_block component: "tovu/site-header", tagline: "…" %} renders a
//     component from the SAME registry the declarative tier uses (COMPONENTS).
//   • {{ content | raw }} injects the server-rendered, pre-sanitized TipTap body.
//     Output autoescaping is ON (outputEscape: "escape"), so a bare
//     {{ post.title }} is escaped and only explicitly-`raw` values pass HTML.
//
// C6/ADR-020 §3 Tier-2 guardrails are implemented (LiquidJS pinned ≥10.26.0
// per package.json; render isolation + fs lockdown in `liquid-worker.ts`,
// spawned per render by `liquid-sandbox.ts`'s `renderLiquidInSandbox`; the
// tag/filter allowlist + lint-before-publish in
// `features/theme/liquid-allowlist.ts`, wired into `loadTheme()` and
// defensively re-checked in the worker). The Liquid engine construction and
// `render_block` tag registration now live in `liquid-worker.ts`, not here —
// this file only forwards to the sandbox.
// ---------------------------------------------------------------------------

/** Templated (LiquidJS) tier body — resolves the route to a `.liquid` template, renders it inside its
 *  own `worker_threads` sandbox, and degrades to {@link fallbackSiteBody} on ANY failure: a syntax
 *  error, a disallowed tag/filter the worker's defensive re-lint caught, or a sandbox timeout/OOM.
 *  Never a 500 (SPEC-004 REQ-10 spirit). */
async function renderTemplatedTierBody(
  { theme, route, liquidTemplateIdOverride, ctx, required }: { theme: NonNullable<RenderSiteRequired['theme']>; route: SiteRenderContext["route"]; liquidTemplateIdOverride: string | undefined; ctx: SiteRenderContext; required: RenderSiteRequired }, _optional = {}
): Promise<string> {
  const liquidId = liquidTemplateIdOverride ?? required.resolveLiquidTemplateId({ route, liquidTemplates: theme.liquidTemplates });
  const source = liquidId ? theme.liquidTemplates[liquidId] : undefined;
  try {
    // Workers use this module's block/data seams, never the parent-side worker launcher.
    const { renderLiquidInSandbox } = await required.loadLiquidSandbox();
    return source
      ? await renderLiquidInSandbox({ source, ctx })
      : fallbackSiteBody(ctx, route, required);
  } catch (err) {
    return `<!-- theme render error: ${escapeHtml({ text: (err as Error).message })} -->${fallbackSiteBody(ctx, route, required)}`;
  }
}

/** Handlebars tier body — same contract as {@link renderTemplatedTierBody}, engine swapped: resolve
 *  the route to a `.hbs` template, render it inside its own `worker_threads` sandbox, and degrade to
 *  {@link fallbackSiteBody} on ANY failure. Never a 500. */
async function renderHandlebarsTierBody({ theme, route, ctx, required }: { theme: NonNullable<RenderSiteRequired['theme']>; route: SiteRenderContext["route"]; ctx: SiteRenderContext; required: RenderSiteRequired }, _optional = {}): Promise<string> {
  const hbsId = required.resolveHandlebarsTemplateId({ route, handlebarsTemplates: theme.handlebarsTemplates });
  const source = hbsId ? theme.handlebarsTemplates[hbsId] : undefined;
  try {
    const { renderHandlebarsInSandbox } = await required.loadHandlebarsSandbox();
    return source ? await renderHandlebarsInSandbox({ source, ctx }) : fallbackSiteBody(ctx, route, required);
  } catch (err) {
    return `<!-- theme render error: ${escapeHtml({ text: (err as Error).message })} -->${fallbackSiteBody(ctx, route, required)}`;
  }
}

/** Declarative (JSON block-tree) tier body — the default tier, synchronous unlike its two siblings
 *  above since `renderBlock`'s own walk never crosses a `worker_threads` boundary. */
function renderDeclarativeTierBody({ theme, route, ctx, required }: { theme: NonNullable<RenderSiteRequired['theme']>; route: SiteRenderContext["route"]; ctx: SiteRenderContext; required: RenderSiteRequired }, _optional = {}): string {
  const templateId = required.resolveTemplateId({ route, templates: theme.templates });
  const tree = templateId ? theme.templates[templateId] : undefined;
  return tree ? required.renderBlock({ node: tree, ctx }) : fallbackSiteBody(ctx, route, required);
}

/** The `<title>` `pageShell` renders — the viewed post's own title on the `post` route, the site
 *  title everywhere else (including a `post` route whose post somehow isn't set). */
function resolvePageTitle({ route, post, siteTitle }: { route: SiteRenderContext["route"]; post: PostRecord | undefined; siteTitle: string }, _optional = {}): string {
  return route === "post" && post ? `${post.title} — ${siteTitle}` : siteTitle;
}

/**
 * Render a page through a declarative theme. Resolves the route to a template
 * and walks its block tree. If the theme lacks the needed template, falls back
 * to a minimal built-in body so a partial theme never 500s (SPEC-004 REQ-10).
 *
 * `async` because the "templated" (LiquidJS) tier renders inside an isolated
 * `worker_threads` worker (ADR-020 §3 render isolation, C6) — the declarative
 * tier's own `renderBlock` walk stays fully synchronous, so most calls still
 * resolve on the same tick the returned promise is awaited.
 */
export async function renderSite(required: RenderSiteRequired, _optional = {}): Promise<string> {
  const { theme, route } = required;
  const ctx = buildSiteRenderContext(required);

  // No theme: straight to the fallback body, which is exactly the path a theme missing this route's
  // template already takes — so this is not a new render path, it is an existing one reached one
  // step earlier. Every tier branch below would otherwise dereference `theme`.
  if (theme === null) {
    const title = resolvePageTitle({ route, post: required.post, siteTitle: required.siteTitle });
    const body = fallbackSiteBody(ctx, route, required);
    return finishManagedDocument({ required, title, body });
  }

  const staticHomePage = await renderStaticTierHomePage({ theme, route, staticMenus: required.staticMenus, extraHead: required.extraHead, siteAssistantEnabled: required.siteAssistantEnabled ?? false, renderAssets: required.renderAssets, required });
  if (staticHomePage !== undefined) return staticHomePage;

  let body: string;
  if (theme.manifest.tier === "templated") {
    body = await renderTemplatedTierBody({ theme, route, liquidTemplateIdOverride: required.liquidTemplateIdOverride, ctx, required });
  } else if (theme.manifest.tier === "handlebars") {
    body = await renderHandlebarsTierBody({ theme, route, ctx, required });
  } else {
    body = renderDeclarativeTierBody({ theme, route, ctx, required });
  }

  const title = resolvePageTitle({ route, post: required.post, siteTitle: required.siteTitle });
  return finishManagedDocument({ required, title, body });
}

/** Resolve body contributions before the document slots, so optional comment assets join declarations. */
async function finishManagedDocument({ required, title, body }: { required: RenderSiteRequired; title: string; body: string }): Promise<string> {
  const transformed = required.transformBody ? await required.transformBody({ html: body }) : body;
  const scripts = [...required.theme?.manifest.scripts ?? [], ...required.scripts ?? []];
  const documentAssets = required.renderAssets ? await required.renderAssets({ scripts }) : { head: required.renderScriptAssets({ scripts: scripts.filter(script => script.consent === undefined) }), body: '' };
  return required.pageShell({ title, theme: required.theme, body: transformed, extraHead: required.extraHead, siteAssistantEnabled: required.siteAssistantEnabled, documentAssets });
}

