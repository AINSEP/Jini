---
"@jini-ai/cms": patch
---

The public liveness probes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/public-http/routes/ops/health`: `healthRoute` for `GET /health`, `healthzRoute` for `GET /healthz`). Both read no deps, never authorize and answer `{ ok: true }`; a host mounts them ahead of its body parsers and session middleware. Wire bodies and statuses are unchanged. The readiness probe (`/readyz`) is not part of this change.
