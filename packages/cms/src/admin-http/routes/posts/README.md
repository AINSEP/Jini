# admin-http/routes/posts

Server-neutral `defineJsonRoute` specs for the admin post READ routes. Why the engine owns route
specs and the host owns mounting: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).
The post domain (lookup, DTO, published history) still lives in the host, so it arrives injected.

## Wiring

**Provides:** `postListRoute` (GET `…/posts`), `postGetRoute` (GET `…/posts/:postId`, id or slug),
plus `shared.ts` (`authorizePostRead`, `PostRoutePrincipal`).

**Needs injected** (each route's own deps type, nothing wider):
- `PostListRouteDeps`: `workspaceId`, `listPostResponses` (host reader + admin post DTO, in list order).
- `PostGetRouteDeps`: `workspaceId`, `readPost` (id-or-slug lookup → `{ post, everPublished }`),
  `isPostNotFound` (recognizes the host's not-found error; answered as `404 { error: <its message> }`).
- Host ports: `workspace`, `authenticate` (sets the `{ id }` principal), `authorize` (asked for
  `content.read` on `post`, no entity id), `onError` (refusals as-is, anything else as the host's private 500).

```ts
import { mountJsonRoute } from "@jini-ai/http-kit";
import { postGetRoute } from "@jini-ai/cms/admin-http/routes/posts/get-by-id";

mountJsonRoute({ app, spec: { ...postGetRoute, ports: hostAdminPorts }, deps: {
  workspaceId,
  readPost: (i) => posts.readAdmin(i),
  isPostNotFound: ({ err }) => err instanceof HostPostNotFound,
} });
```

Bind collaborators per request (closures over the host's deps), never copy them at mount time:
host tests replace collaborators after registration.

**Never imports:** Express or any server-framework type, `@jini-ai/http-kit`, host modules,
product copy. Unmapped failures are rethrown for the host's error port.
