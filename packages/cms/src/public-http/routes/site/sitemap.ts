import { serializeSitemapXml } from "../../../seo/index.js";
import type { SitemapEntry } from "../../../seo/index.js";
import { servingOriginOf, textDocument, type PublicSeoRawRoute } from "./seo-route-shared.js";

/** What the host injects. The cache policy is the host's: the answer depends on the request authority. */
export interface SitemapRouteDeps {
  readonly workspaceId: string;
  /** Resolves once the SEO ports are ready to read. */
  readonly seoReady: Promise<void>;
  /** The `Cache-Control` value of a successful answer. */
  readonly cacheControl: string;
  /** The stored dependencies; only the stored `renderBaseUrl` is read, as the fallback origin. */
  readonly seoDeps: { readonly renderBaseUrl?: string | undefined };
  /** The host's sitemap service: entries whose `loc` are absolute on `renderBaseUrl`. */
  readonly buildSitemap: (required: { workspaceId: string }, optional: { renderBaseUrl?: string | undefined }) => Promise<readonly Pick<SitemapEntry, "loc" | "lastmod">[]>;
}

/**
 * `GET /sitemap.xml` — public, unauthenticated; entries are located on the origin the request was served from
 * (the host's `servingOrigin`), falling back to the stored origin when none could be formed.
 * @complexity One sitemap build (cached by the host's service) plus O(n) serialization.
 */
export const sitemapRoute: PublicSeoRawRoute<SitemapRouteDeps> = {
  method: "get",
  path: "/sitemap.xml",
  requestFacts: true,
  handle: async ({ raw, deps }) => {
    await deps.seoReady;
    const origin = servingOriginOf({ raw });
    const entries = await deps.buildSitemap({ workspaceId: deps.workspaceId }, { renderBaseUrl: origin ?? deps.seoDeps.renderBaseUrl });
    return textDocument({ body: serializeSitemapXml({ entries }), contentType: "text/xml", cacheControl: deps.cacheControl });
  },
};
