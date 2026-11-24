---
"@jini-ai/admin": minor
"@jini-ai/core": minor
---

Add `createAdminHttp` at `@jini-ai/admin/shell/lib/admin-http/request`: a host session client (deadline, session invalidation, one restart retry, final failure notice) built from injected ports. It reuses the route-group transport's fetch-failure, body-parse and envelope stages. Core's `@jini-ai/core/admin-runtime` adds the `AdminHttpError`, `AdminHttpOptions` and `AdminHttpReconnect` types; `AdminApiError` satisfies `AdminHttpError`.
