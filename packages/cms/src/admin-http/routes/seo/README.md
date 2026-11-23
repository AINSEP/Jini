# SEO admin route specs

Four server-neutral JSON route specs for SEO admin (SPEC-008): `seoGetEntryRoute`,
`seoGetEntryAnalyzeRoute`, `seoPutEntryRoute` and `seoPostSitemapRegenerateRoute`. Each is a
`defineJsonRoute` spec (`@jini-ai/core/contracts/server`) gated by `admin.seo.manage`.

## Wiring

**Needs injected**, per route, its own deps type (never a host route bag):
- `SeoGetEntryRouteDeps` / `SeoGetEntryAnalyzeRouteDeps`: `workspaceId`, `seoReady`, `seoDeps` (`GetEntryMetaDeps`).
- `SeoPutEntryRouteDeps`: the above plus `authorize` (the RBAC `AuthorizeFn` the write chokepoint calls itself), `clock`, `seoDeps.postRepo`/`seoDeps.media` (write ports) and `sitemapService.invalidateSitemapCache`.
- `SeoPostSitemapRegenerateRouteDeps`: `workspaceId`, `seoReady`, `sitemapService.regenerateSitemapCache`.
- Host ports (`JsonRoutePorts<Deps, SeoRoutePrincipal>`): `workspace` (foreign workspace 404), `authenticate` (principal `{ id }`), `authorize` (403 body), `onError` (unexpected failure body).

**Provides:** the specs; `SeoRoutePrincipal`; `seoPutEntryRefusal` (the put route's domain error → `{ status, body }` table). Domain refusals arrive at `onError` as `RouteRefusalError` with their exact flat body; anything else is rethrown untouched.

```ts
import { mountJsonRoute } from "@jini-ai/http-kit";
import { seoGetEntryRoute } from "@jini-ai/cms/admin-http/routes/seo/get-entry";

mountJsonRoute({
  app,
  spec: { ...seoGetEntryRoute, ports: hostAdminPorts },
  deps: { workspaceId, seoReady, seoDeps, authorize: rbacAuthorize },
});
```

**Must never import:** a server framework (Express types included), host route bags or guard
helpers, host logging/failure formatters, or `@jini-ai/db`. Same-package SEO services are
imported relatively (`../../../seo/*.js`).
