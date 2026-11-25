import { formatIsoDate } from "../../../../widgets/date-label.js";
import type { AssignedTermView } from "../../../../taxonomy/index.js";
import { escapeHtml } from "@jini-ai/core/text";
import type { SiteRenderContext } from "../render-context.js";
import type { PublicPostRecord as PostRecord } from "../../../../posts/post.js";
import { projectPostBody } from "../../../../media/cover-image.js";
import type { JsonValue } from "@jini-ai/core/primitives";
import { postAuthorForDisplay } from "@jini-ai/core/contracts/site/post-author";
import { postDisplayDateIso } from "@jini-ai/core/scheduled-publish";
import type { BodyRenderPorts } from "./body-render-ports.js";

/** `YYYY-MM-DD` — the calendar day of `iso` in the site's `timeZone` (UTC when absent), so a post
 *  published at 11pm in Los Angeles is not shown as the next day. Bug D follow-up. */
export function shortDate({ iso, timeZone }: { iso: string; timeZone: string | undefined }, _optional = {}): string {
  return formatIsoDate({ iso }, timeZone === undefined ? {} : { timeZone });
}

/**
 * Renders {@link SiteRenderContext.assignedTerms} as a labelled, PLAIN-TEXT block — never a link.
 * There is still no term-archive route anywhere in this codebase: `urlFor`/`isActive` resolve every
 * `termRef` route target to `null` (`@jini-ai/cms/routing`'s own `TermRefTarget` doc — "NOT
 * resolvable today"), so linking a term here would only ever produce a 404. Terms are grouped by
 * their owning taxonomy's name (e.g. "Category: QA"), preserving the order the caller returned them
 * in (assignment order) rather than sorting alphabetically, so an author who assigned "Tag" before
 * "Category" sees Tag first.
 *
 * Returns `""` for no assigned terms — the overwhelmingly common case while this feature is new — so
 * every page/post with nothing assigned renders byte-identical to before this existed. Shared by
 * every render surface that produces a post/page body: `renderViaTemplate`'s own static-tier splice
 * (`routes/site/pages.ts`) and {@link renderPostBody} (the declarative/templated/handlebars tiers,
 * plus the tierless fallback body) both call this same function rather than keeping separate copies.
 *
 * @complexity O(n) in the number of assigned terms (typically single digits).
 */
export function renderAssignedTermsBlock({ terms }: { terms: readonly AssignedTermView[] }, _optional = {}): string {
  if (terms.length === 0) return "";
  const groups = new Map<string, string[]>();
  for (const term of terms) {
    const bucket = groups.get(term.taxonomyName);
    if (bucket) bucket.push(term.termName);
    else groups.set(term.taxonomyName, [term.termName]);
  }
  const groupsHtml = Array.from(groups.entries())
    .map(([taxonomyName, termNames]) => {
      const items = termNames.map((name) => `<span class="entry-terms__term">${escapeHtml({ text: name })}</span>`).join(", ");
      return `<span class="entry-terms__group"><span class="entry-terms__taxonomy">${escapeHtml({ text: taxonomyName })}:</span> ${items}</span>`;
    })
    .join(" ");
  return `<div class="entry-terms">${groupsHtml}</div>`;
}

/**
 * Renders `ctx.post`'s body to HTML, branching on `bodyFormat` (SPEC-047 Slice 1). A `"doc"` post
 * walks its TipTap `bodyJson` exactly as before; an `"html"` Page's `bodyHtml` is bespoke,
 * pre-authored markup — there is no tree to walk, so its `data-embed-type`
 * placeholders are substituted by the injected `renderHtmlPageBody` (Slice 2) and the result emitted as-is.
 *
 * `body_html` is never HTML-escaped here: SPEC-047/ADR-056's own disclosure (`update-html.ts`'s file
 * header) is that a Page's stored markup carries the same trust level the theme layer already has —
 * escaping it would not make this safer, it would just break the feature (the whole point of an
 * "html" Page is that its body IS HTML, not text describing HTML).
 *
 * Taxonomy render-surface gap fix (2026-09-03) — `ctx.assignedTerms` is appended AFTER the resolved
 * body, not spliced into it: assigned terms are metadata ABOUT the entry, not part of its authored
 * body, the same "filed under" footer position `renderViaTemplate` (`routes/site/pages.ts`) already
 * uses for the static tier. This is the ONE place the declarative, templated (Liquid), and handlebars
 * tiers each read the rendered post body from (`buildTemplateRenderData`'s `post.content`, the
 * declarative `"content"` slot, and the tierless `entryContent` fallback all call this function), so
 * fixing it here closes the gap for all three at once rather than three separate splice points.
 *
 * @complexity O(1) for a `"doc"` post (delegates to the injected doc renderer's own O(n)); O(n) over
 * `bodyHtml`'s length for an `"html"` Page (delegates to the injected html-body renderer's own single
 * substitution pass — this function never re-scans). Plus {@link renderAssignedTermsBlock}'s own
 * O(n) over the (typically single-digit) assigned-terms count.
 * @overallScore 100
 */
export function renderPostBody({ ctx, post, renderers }: { ctx: SiteRenderContext; post: PostRecord; renderers: BodyRenderPorts }, _optional = {}): string {
  // `post` is passed already narrowed (L082b): all three callers (`entryContent`, the `content`
  // slot, `buildTemplateRenderData`) check `ctx.post` first, so the old in-here `!post` guard
  // could never fire.
  // An "html" body renders unmodified: only `pages.edit_html` holders (theme-source trust) write it,
  // and its own inline scripts are the page (`admin-http/routes/pages/update-html.ts`, Authorization).
  // `sanitizePageHtml` is for less-trusted Raw HTML widget content; on page bodies it stripped
  // a site's carousel scripts and icons (owner report, 2026-10-12).
  const body =
    post.bodyFormat === "html"
      ? renderers.renderHtmlPageBody({ html: post.bodyHtml ?? "", resolved: ctx.pageHtmlEmbeds })
      : renderers.renderDocNode({ node: projectPostBody({ post, mediaLookup: ({ ref }) => ctx.mediaAssetMetadata.get(ref) ?? null,
          hasPublicTransform: ctx.mediaTransformVersions.has("public") }) as JsonValue }, { inlineResolved: ctx.widgetInlineResolved, mediaTransformVersions: ctx.mediaTransformVersions, mediaAssetMetadata: ctx.mediaAssetMetadata });
  return body + renderAssignedTermsBlock({ terms: ctx.assignedTerms });
}

export function entryContent({ ctx, renderers, bylinePrefix }: { ctx: SiteRenderContext; renderers: BodyRenderPorts; bylinePrefix: string }, _optional = {}): string {
  if (!ctx.post) return "";
  const author = postAuthorForDisplay({ post: ctx.post });
  // The byline is the date line's next item, a `span` inside `.entry-meta` (2026-10-11): as its own
  // `<p>` after that line it took the theme's body-text size instead of the date's small muted type.
  // `.entry-meta` is a plain text line (no flex gap), so the items need a written separator.
  const date = shortDate({ iso: postDisplayDateIso(ctx.post), timeZone: ctx.timeZone });
  const bylineSeparator = date ? " · " : "";
  const byline = author ? `${bylineSeparator}<span class="post-author">${escapeHtml({ text: bylinePrefix })}${escapeHtml({ text: author })}</span>` : "";
  return `<div class="wrap"><a class="back" href="/">← ${escapeHtml({ text: ctx.siteTitle })}</a><article class="entry"><h1 class="entry-title">${escapeHtml({ text: ctx.post.title })}</h1><p class="entry-meta">${escapeHtml({ text: date })}${byline}</p><div class="prose">${renderPostBody({ ctx, post: ctx.post, renderers })}</div></article></div>`;
}
