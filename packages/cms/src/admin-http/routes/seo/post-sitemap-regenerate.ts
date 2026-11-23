import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSeoSitemapRegenerateEnvelope } from "@jini-ai/core/contracts/site/cms-seo";

import type { createSitemapService } from "../../../seo/sitemap.js";

/** The sitemap service the host builds once per app (`createSitemapService`). */
type SitemapService = ReturnType<typeof createSitemapService>;
import { authorizeSeo, type SeoRoutePrincipal } from "./shared.js";

/** The deps this route reads: the app's one sitemap cache (routes, tools and subscriptions share it). */
export interface SeoPostSitemapRegenerateRouteDeps {
  workspaceId: string;
  seoReady: PromiseLike<unknown>;
  sitemapService: Pick<SitemapService, "regenerateSitemapCache">;
}

/** POST force-rebuild the cached sitemap (SPEC-008 `SEO_POST_SITEMAP_REGENERATE`); answers 202. */
export const seoPostSitemapRegenerateRoute = defineJsonRoute<Record<string, never>, AdminSeoSitemapRegenerateEnvelope, SeoPostSitemapRegenerateRouteDeps, SeoRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/sitemap/regenerate",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeSeo({ authorize, ready: deps.seoReady, entityType: "seo-sitemap" });
    await deps.sitemapService.regenerateSitemapCache({ workspaceId: deps.workspaceId }, {});
    return ok({ value: { data: { accepted: true as const } } });
  },
}, { successStatus: 202 });
