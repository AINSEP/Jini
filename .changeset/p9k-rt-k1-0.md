---
"@jini-ai/core": minor
"@jini-ai/http-kit": minor
"@jini-ai/cms": patch
---

Move host-neutral route-refusal and content-entry body-cap code from the host.

- `@jini-ai/core/contracts/server`: `RouteRefusalError` / `rejectRoute` (a deliberate, caller-visible refusal carrying `response: { status, body }` for the host's `onError` port) and `payloadTooLargeError`.
- `jsonRoute` (core) and `mountJsonRoute` (http-kit): a returned parse or handler failure, and a body over `maxBodyBytes`, now take the same path as a thrown `ClientFacingError`. With a `ports.onError`, the port receives a `ClientFacingError` for each and owns the envelope; without one, the answer is unchanged.
- `@jini-ai/http-kit`: `JsonRouteSpec.maxBodyBytes` (non-GET; re-measures the parsed body and refuses with core's 413 `PAYLOAD_TOO_LARGE`).
- `@jini-ai/cms/admin-http/limits`: `CONTENT_ENTRY_MAX_BODY_BYTES` (1 MiB).
