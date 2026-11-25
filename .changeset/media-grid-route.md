---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

`@jini-ai/core/contracts/site/cms-admin-media` adds the bounded media grid wire types (`MediaGridTab`, `MediaGridOrder`, `MediaGridRequest`, `MediaGridPage`). The new Node entry `@jini-ai/cms/admin-http/routes/media/grid` exports `mediaGridRoute` (GET `/api/admin/v1/workspaces/:workspaceId/media/grid`) and `parseMediaGridInput`: one bounded page per tab and order (limit 1..100, default 50) behind an opaque cursor bound to the workspace, tab and order, or one exact asset by `itemId`, with workspace-wide counts. The existing media list route and response are unchanged.
