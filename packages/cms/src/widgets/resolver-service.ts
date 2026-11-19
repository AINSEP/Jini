import { widgetReport } from "./resolver-contracts.js";
import { resolveGalleryEmbeds } from "./gallery-resolver.js";
import { resolveTaxonomyEmbeds } from "./resolvers/taxonomy.js";
import type { PageEmbedType } from "./page-embed-types.js";
import type { HtmlEmbedResolver } from "./resolver-contracts.js";
import { resolveWidgetTypeEmbeds, resolveFormTypeEmbeds } from "./html-widget-embeds.js";
import { resolveMediaTypeEmbeds } from "./media-embed-resolution.js";
import { resolvePostTypeEmbeds } from "./post-embed-resolution.js";
import { resolveContentTypeEmbeds } from "./content-embed-resolution.js";

/**
 * Registry of known embed types (SPEC-047, generalized 2026-08-07). Adding a new embed type is
 * registering one more entry here — no other file in `resolveHtmlPageEmbeds`'s call chain changes,
 * and `html-embeds.ts`'s scanner already reports any type token it finds regardless of whether an
 * entry exists here (see that file's own doc). A type ABSENT from this registry is the "unknown
 * embed type" log path in {@link resolveHtmlPageEmbeds}; a type PRESENT here whose resolver still
 * can't find a given id/name is the "resolver-internal miss" log path inside that resolver
 * (`resolveWidgetTypeEmbeds`/`resolveMediaTypeEmbeds` above) — DECIDED (2026-08-07) to keep these
 * two distinguishable in logs even though both render the identical REQ-28 placeholder externally:
 * an author's markup typo (unknown type) and an author's stale reference (known type, dead id) are
 * different problems needing different fixes.
 *
 * Historically `form` was removed (2026-08-10) because it was shorthand for a synthetic
 * contact-form widget. The owner explicitly restores both spellings (2026-10-04): keep that
 * synthetic instance on the SAME registered contact-form resolver so the two cannot drift.
 */
export const HTML_EMBED_RESOLVERS: Readonly<Record<string, HtmlEmbedResolver>> = {
  // Template filling needs parse5, which this universal module must not load: the node-only
  // `resolveHtmlPageEmbeds` (`html/resolve-html-page-embeds.ts`) overrides this entry with the real
  // resolver. Reached from here, every plugin occurrence keeps its authored fallback.
  plugin: async () => new Map(),
  widget: resolveWidgetTypeEmbeds,
  form: resolveFormTypeEmbeds,
  taxonomy: (refs, deps) => resolveTaxonomyEmbeds({ refs, deps }),
  media: async (refs, deps, context) => {
    const inline = refs.filter(ref => ref.config?.content !== undefined || ref.config?.items !== undefined || ref.config?.html !== undefined);
    const ordinary = refs.filter(ref => !inline.includes(ref));
    const media = await resolveMediaTypeEmbeds(ordinary, deps, context);
    const content = await resolveGalleryEmbeds({
      refs: inline.map(ref => ({ ...ref, config: (ref.config?.content ?? ref.config) as Readonly<Record<string, unknown>> })),
      resolveMedia: ({ refs }) => resolveMediaTypeEmbeds(refs, deps, context),
    }, { reportIssue: ({ key, messages }) => widgetReport({ context }).warn({ message: 'unresolved media content' }, { meta: { key, messages } }) });
    return new Map([...media, ...content]);
  },
  gallery: (refs, deps, context) => resolveGalleryEmbeds({
    refs,
    resolveMedia: ({ refs: mediaRefs }) => resolveMediaTypeEmbeds(mediaRefs, deps, context),
  }, {
    reportIssue: ({ key, messages }) => widgetReport({ context }).warn({ message: 'unresolved gallery embed' }, { meta: { workspaceId: context.workspaceId, key, messages } }),
  }),
  post: resolvePostTypeEmbeds,
  content: resolveContentTypeEmbeds,
} satisfies Record<PageEmbedType, HtmlEmbedResolver>;

/**
 * Marker types that exist in the shared `data-embed-config` vocabulary (`packages/cms/src/widgets/markers/marker.ts`) but
 * are deliberately absent from {@link HTML_EMBED_RESOLVERS} — a theme's own structural markers, owned
 * end-to-end by `features/theme/static-render.ts`'s `resolveSlots` (`"partial"`) and
 * `injectMenuEmbeds` (`"menu"`), which run AFTER this stage on every static-tier page render
 * (`routes/site/pages.ts`'s `renderViaTemplate`: `resolveHtmlPageEmbeds` first, then
 * `renderStaticPage`). `isPageEmbedType`'s own doc already tells `render.ts`'s `renderHtmlPageBody` to
 * leave these two untouched rather than substitute a placeholder over the nav — that fixed the
 * SUBSTITUTION half of "this stage sees markers it does not own" (2026-08-10). This constant fixes the
 * matching LOGGING half, which that earlier fix did not touch.
 *
 * Without this, {@link resolveHtmlPageEmbeds}'s "unknown embed type" warning fired for `menu`/`partial`
 * on every single static-tier render — confirmed live during the 2026-08-16 GitHub Pages export
 * (`gh-pages` commit `c0e52de2`, published demo): the log claimed "every
 * occurrence degrades to the placeholder," which was false — curling the published page showed real,
 * resolved `<a href>` links in both the nav and footer, zero placeholder markup anywhere. The page was
 * never broken; only the diagnostic was. Left uncorrected, that false alarm fires on every render and
 * trains a reader to ignore this log line, burying the ONE case it exists to catch: an author's actual
 * markup typo (`HTML_EMBED_RESOLVERS`'s own doc on why "unknown type" and "known type, dead id" must
 * stay distinguishable applies equally to "known-and-owned-elsewhere" vs. "owned nowhere").
 *
 * A type in this set must stay absent from `HTML_EMBED_RESOLVERS` — do not "fix" the warning by adding
 * a resolver entry instead; see `isPageEmbedType`'s own doc for why that would reintroduce the
 * substitution bug this file already fixed once.
 *
 * **Why this isn't just `!isPageEmbedType(type)`.** `isPageEmbedType` is membership in `PAGE_EMBED_TYPES`,
 * which the compiler holds equal to `HTML_EMBED_RESOLVERS`'s keys — exactly the same fact this loop's own
 * `HTML_EMBED_RESOLVERS[type]` lookup already tests, one
 * bit: "is this resolver-service's own type." That bit is `false` for `partial`/`menu` AND for a genuine
 * unregistered/typo type alike, so it cannot distinguish "known, owned by a later stage" from "owned
 * nowhere" — using it to gate the warning would silence the ONE case the warning exists for, not just
 * the two it shouldn't fire for. This set names the missing fact directly instead. It intentionally
 * duplicates `static-render.ts`'s own `marker.type !== "menu"`/`!== "partial"` literals rather than
 * importing them (that file is a different feature's territory in this change's dispatch) — the real
 * fix, hoisting a shared constant into `packages/cms/src/widgets/markers/marker.ts` for both files to import, is proposed but
 * not yet authorized; see `ADS-memory/reports/2026-08-16-embed-placeholder-gap.md`'s "Reuse decision"
 * section. Keep this set's members in sync with those two literals, not with `isPageEmbedType`.
 *
 * `"post-previews"` (2026-09-03) joins the set for the identical reason: it is resolved by
 * `static-render.ts`'s `injectPostPreviewsEmbeds`, AFTER this stage, on every static-tier page
 * render that reaches `renderStaticPage` — same duplicated-literal debt as the other two entries
 * (see `POST_PREVIEWS_MARKER_TYPE`, `packages/cms/src/widgets/markers/marker.ts`), not yet hoisted for the same reason.
 *
 * `"collection"` (2026-09-23) joins the set for the identical reason: it is resolved by
 * `static-render.ts`'s `injectCollectionEmbeds`, AFTER this stage — same duplicated-literal debt as
 * the other three entries (see `COLLECTION_MARKER_TYPE`, `packages/cms/src/widgets/markers/marker.ts`).
 *
 * `"featured-image"` (2026-10-05) joins for the identical reason: `static-render.ts`'s
 * `injectFeaturedImage` resolves it (see `FEATURED_IMAGE_MARKER_TYPE`, `packages/cms/src/widgets/markers/marker.ts`).
 *
 * `"post-author"` (2026-10-11) joins for the identical reason: `static-render.ts`'s
 * `injectPostAuthor` fills the byline. Without it this stage warned once per post render while the
 * byline rendered correctly.
 */
export const THEME_OWNED_MARKER_TYPES: ReadonlySet<string> = new Set(["partial", "menu", "post-previews", "collection", "featured-image", "post-author", "comments"]);


/**
 * `isPageEmbedType` (the "does this stage OWN the marker type" question, with its own doc) lives in
 * the dependency-free `page-embed-types.ts` so `render.ts` and the theme render workers can ask it
 * without loading this file's service graph. Re-exported so existing importers keep working.
 */
export { isPageEmbedType } from "./page-embed-types.js";
