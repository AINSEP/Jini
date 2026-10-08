/**
 * @file The page-embed stage's own marker types, as a dependency-free leaf.
 *
 * `resolver-service.ts`'s `HTML_EMBED_RESOLVERS` is the registry these name; it `satisfies`
 * `Record<PageEmbedType, …>`, so the compiler fails if the two ever disagree in either direction.
 * The list lives here rather than being read off that registry because `render.ts` needs
 * `isPageEmbedType`, and `render.ts` is loaded by every theme render worker (`handlebars-worker.ts`,
 * `liquid-worker.ts`). Importing `resolver-service.ts` from there pulled its post/media/entries
 * services, and through them the DB kernels and the S3 blob client, into every worker spawn:
 * ~990 modules and seconds of cold start per render (see `__tests__/worker-import-graph.test.ts`
 * under `server/inbound/public-http/http/site/`).
 */

export const PAGE_EMBED_TYPES = ["widget", "form", "taxonomy", "media", "post", "content"] as const;

export type PageEmbedType = (typeof PAGE_EMBED_TYPES)[number];

const PAGE_EMBED_TYPE_SET: ReadonlySet<string> = new Set(PAGE_EMBED_TYPES);

/**
 * Does the page-embed stage OWN this marker type — i.e. is a REQ-28 placeholder the honest answer
 * when it fails to resolve?
 *
 * This question did not exist before the 2026-08-10 marker unification, and its absence was a real
 * bug for exactly as long as the unification was half-done. `html-embeds.ts` used to match only an
 * empty `<div data-embed-type="…">`, so a theme's own `partial`/`menu` markers were INVISIBLE to
 * this stage — "unknown type" could only ever mean an author's typo, and rendering the REQ-28
 * placeholder for it was right. Sharing one permissive parser made every marker visible to every
 * consumer, so `renderHtmlPageBody` began substituting placeholders over the nav, the docs menu, and
 * the footer of any post rendered through a theme template — three markers a LATER stage
 * (`static-render.ts`'s `resolveSlots`/`injectMenuEmbeds`) owns and would have resolved.
 *
 * So ownership must be asked of the resolver registry (`resolver-service.ts`'s
 * `HTML_EMBED_RESOLVERS`, whose keys are exactly {@link PAGE_EMBED_TYPES}), never inferred from
 * "did resolution produce anything". A type present there that failed to resolve still degrades to
 * the placeholder — that is REQ-28 and unchanged. A type absent from there is not this stage's to
 * render OR to blank: it is left exactly as authored, which is the shared parser's own "unresolved
 * means untouched" invariant.
 *
 * The cost of being wrong is asymmetric and that is why the default is untouched: a marker wrongly
 * left alone is visible in the output the moment anyone looks at the page, while a marker wrongly
 * replaced is a silently-deleted nav that renders as a tidy, plausible page with a hole in it.
 */
export function isPageEmbedType({ type }: { type: string }, _optional: Record<string, never> = {}): boolean {
  return PAGE_EMBED_TYPE_SET.has(type);
}
