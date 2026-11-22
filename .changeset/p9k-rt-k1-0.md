---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

Move host-neutral route-refusal and content-entry body-cap code from the host.

- `@jini-ai/core/errors/route-refusal`: `RouteRefusalError` / `rejectRoute` (a deliberate, caller-visible refusal carrying `response: { status, body }` for the host's `onError` port).
- `@jini-ai/cms/admin-http/limits`: `CONTENT_ENTRY_MAX_BODY_BYTES` (1 MiB); Express routes still enforce it through host middleware.
