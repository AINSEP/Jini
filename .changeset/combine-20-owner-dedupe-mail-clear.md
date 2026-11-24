---
"@jini-ai/cms": major
"@jini-ai/core": major
"@jini-ai/platform": major
"@jini-ai/admin": minor
"@jini-ai/user-management": minor
---

combine-20 removals. `@jini-ai/cms/publish/content/dialog/*` is gone; `@jini-ai/cms/publish/content/ui/*` is the one owner. `@jini-ai/core/contracts/site/capability-providers-comments` is gone; import `contracts/site/comments-providers`. The seven `Admin*` external-MCP admission types live only in `contracts/hosted-mcp/admissions` (no longer duplicated in `contracts/site/cms-external-mcp`). The captured-mail repo drops `summarizeCaptured` and the workspace-wide `clearCaptured` for `reviewCaptured` + `clearReviewedCaptures` (deletes only the reviewed capture IDs, in one transaction); the request/plan/preview/result types and `MAIL_CAPTURE_CLEAR_PERMISSION` now live in `@jini-ai/core/contracts/mail`. `useEmailActivity` requires `useLoadHook` and `useCaptureClearFlowHook`.
