---
"@jini-ai/cms": patch
---

Add one-row media-provider routes: `PATCH` and `DELETE` `/api/admin/v1/workspaces/:workspaceId/media/providers/:providerId`
(`@jini-ai/cms/admin-http/routes/media/patch-provider`, `@jini-ai/cms/admin-http/routes/media/delete-provider`), with the
whole-set PUT's `admin.integrations.manage` admission and a body of one provider's `apiKey`/`baseUrl`/`model` only.
Every provider route now answers the markers-only map with an opaque store revision as a strong `ETag`; `getProviders`
answers `{ providers, revision }`. The legacy whole-set PUT requires that revision back in `If-Match` (mount with
`readHeaders: ["if-match"]`): a missing or stale basis is `409 MEDIA_PROVIDERS_STALE` with no write, and `saveProviders`
receives `expectedRevision` and answers `{ outcome: "saved", providers, revision }` or `{ outcome: "stale" }`.
