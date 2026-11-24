import { buildFeed, FEED_PATH, renderRssXml, type SeoSitemapDeps } from "../../../seo/index.js";
import { textDocument, withServingOrigin, type PublicSeoRawRoute } from "./seo-route-shared.js";

/** What the host injects. The channel title is the host's site title (its own settings and fallbacks). */
export interface FeedRouteDeps {
  readonly workspaceId: string;
  /** Resolves once the SEO ports are ready to read. */
  readonly seoReady: Promise<void>;
  /** The `Cache-Control` value of a successful answer. */
  readonly cacheControl: string;
  readonly seoDeps: SeoSitemapDeps;
  readonly resolveSiteTitle: (required: { workspaceId: string }) => Promise<string>;
}

/**
 * `GET /feed.xml` — the public RSS 2.0 feed; public and unauthenticated, links on the serving origin.
 * @complexity One feed build (post list) plus O(n) serialization.
 */
export const feedRoute: PublicSeoRawRoute<FeedRouteDeps> = {
  method: "get",
  path: FEED_PATH,
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    await deps.seoReady;
    const seoDeps = withServingOrigin({ raw, seoDeps: deps.seoDeps });
    const siteTitle = await deps.resolveSiteTitle({ workspaceId: deps.workspaceId });
    const feed = await buildFeed({ deps: seoDeps, input: { workspaceId: deps.workspaceId, siteTitle } }, {});
    return textDocument({ body: renderRssXml({ feed }, {}), contentType: "application/rss+xml", cacheControl: deps.cacheControl });
  },
};
