import { computeIndexableEntries, type SeoSitemapDeps } from "../../../seo/sitemap.js";
import { renderLlmsTxt } from "../../../seo/sitemap-documents.js";
import { textDocument, withServingOrigin, type PublicSeoRawRoute } from "./seo-route-shared.js";

/** What the host injects. */
export interface LlmsTxtRouteDeps {
  readonly workspaceId: string;
  /** Resolves once the SEO ports are ready to read. */
  readonly seoReady: Promise<void>;
  /** The `Cache-Control` value of a successful answer. */
  readonly cacheControl: string;
  readonly seoDeps: SeoSitemapDeps;
  readonly resolveSiteTitle: (required: { workspaceId: string }) => Promise<string>;
}

/**
 * `GET /llms.txt` — public, unauthenticated machine-readable index (llmstxt.org): an H1 title, a one-line
 * blockquote, then the links. It derives the index from `computeIndexableEntries`, the same publish /
 * visibility / `noindex` filter the sitemap is built from, so a gated or draft page can never leak here.
 * The entries share the serving origin of the sitemap and feed.
 * @complexity One indexable-entry scan plus O(n log n) ordering.
 */
export const llmsTxtRoute: PublicSeoRawRoute<LlmsTxtRouteDeps> = {
  method: "get",
  path: "/llms.txt",
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    await deps.seoReady;
    const seoDeps = withServingOrigin({ raw, seoDeps: deps.seoDeps });
    const entries = await computeIndexableEntries({ deps: seoDeps, input: { workspaceId: deps.workspaceId } }, {});
    const title = await deps.resolveSiteTitle({ workspaceId: deps.workspaceId });
    const { defaultDescription: description } = await deps.seoDeps.settings.getSeoSettings({ workspaceId: deps.workspaceId });
    return textDocument({ body: renderLlmsTxt({ entries, title }, { description }), contentType: "text/markdown", cacheControl: deps.cacheControl });
  },
};
