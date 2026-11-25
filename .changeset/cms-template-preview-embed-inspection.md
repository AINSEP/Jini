---
"@jini-ai/cms": minor
---

Add `createTemplatePreviewEmbedsRoute` at `@jini-ai/cms/admin-http/routes/posts/template-preview-embeds`: an authenticated, `content.read`-gated JSON route spec that parses a post's rendered template preview HTML as inert data and hands the host's projector only the iframe `src` values, in document order. Node entry (it uses `parse5`).
