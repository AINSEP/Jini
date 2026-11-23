# `admin-http/routes/comments`

Admin route specs for comment moderation (ADR-031 §6/§9) and the workspace `comments.*` settings
(SPEC-035): the moderation queue, the approve/spam/trash/restore/purge actions, and settings GET/PUT.

## Wiring

Architecture and the inject-everything rule: [`extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).
The reference pattern these specs copy is `../redirects/`.

**Provides** (each a `defineJsonRoute` spec; principal type `CommentsRoutePrincipal = { id }`):

| spec | file | deps type |
|---|---|---|
| `commentsModerationQueueRoute` | `moderation-queue.ts` | `CommentsModerationQueueRouteDeps` (`workspaceId`, `commentRepo.listModerationQueue`) |
| `commentsModerationActionRoutes` (4 specs, 204) + `commentsPurgeRoute` (204) | `moderate.ts` | `CommentsModerateRouteDeps` (`workspaceId`, `commentWriteService.applyModeration/purge`) |
| `commentsGetSettingsRoute` | `get-settings.ts` | `CommentsGetSettingsRouteDeps` (`workspaceId`, `commentsSettingsReady`, `getCommentsSettings`) |
| `commentsPutSettingsRoute` | `put-settings.ts` | `CommentsPutSettingsRouteDeps` (`workspaceId`, `commentsSettingsReady`, `setCommentsSettings`) |

**Injected by the host:** the ports (`workspace` guard, `authenticate`, `authorize`, `onError`) and
the settings ledger read/write (`getCommentsSettings` / `setCommentsSettings`), each already bound to
the host's settings store, clock, ids, authorizer and principals.

```ts
import { commentsPutSettingsRoute } from "@jini-ai/cms/admin-http/routes/comments/put-settings";

mountAdminJsonRoute({ app, spec: commentsPutSettingsRoute, deps: {
  workspaceId, authorize,                       // port fields
  commentsSettingsReady,
  setCommentsSettings: (input) => hostSetCommentsSettings(hostSettingsDeps, input),
} }, { failure: { operation: "routes/comments/put-settings", code: "INTERNAL_ERROR" } });
```

**Must never import:** `express`, `@jini-ai/http-kit`, any host code, or any non-core `@jini-ai/*`
package. Only `@jini-ai/core` and `@jini-ai/cms`'s own modules.
