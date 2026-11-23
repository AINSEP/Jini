import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { createSitemapService } from "../../../seo/index.js";
import { authorizeSeoManage, type SeoRouteBaseDeps, type SeoRoutePrincipal } from "./deps.js";

/** The deps this route reads: the host's one sitemap service, so routes/tools/subscriptions share its cache. */
export interface SeoPostSitemapRegenerateRouteDeps extends SeoRouteBaseDeps {
  sitemapService: Pick<ReturnType<typeof createSitemapService>, "regenerateSitemapCache">;
}

/** POST force-rebuild the cached sitemap (SPEC-008 api.spec.md `SEO_POST_SITEMAP_REGENERATE`, tasks.md T047). */
export const seoPostSitemapRegenerateRoute = defineJsonRoute<Record<string, never>, { data: { accepted: true } }, SeoPostSitemapRegenerateRouteDeps, SeoRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/seo/sitemap/regenerate",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await deps.seoReady;
    await authorizeSeoManage({ authorize, entityType: "seo-sitemap" });
    await deps.sitemapService.regenerateSitemapCache({ workspaceId: deps.workspaceId }, {});
    return ok({ value: { data: { accepted: true } } });
  },
}, { successStatus: 202 });
