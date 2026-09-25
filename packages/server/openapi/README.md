# Jini HTTP OpenAPI fragments

These hand-authored OpenAPI 3.0.3 fragments document Jini's own Express route packs—the routes a Jini daemon can mount—not any host product API. They are code-first: a fragment records current parser, handler, response, and security behavior from the route implementation. Fragments are standalone documents so hosts can include only the feature packs they mount. No dependency was added.

| File | Description |
| --- | --- |
| `http-kit-core.yaml` | Health, runs and SSE run events, agents, active context, host editor actions, and daemon status/shutdown. |
| `attachments.yaml` | `POST`/`DELETE /api/attachments` — staged file/image uploads for one agent run over a disk-backed store. |
| `component-catalog.yaml` | `GET /api/components/search` / `GET /api/components/:id` — interactive-UI component discovery. |
| `connectors.yaml` | `POST`/`GET`/`PUT`/`PATCH`/`DELETE /api/connectors/{auth,storage,payments,db,realtime}/...` — JSON transport over five optional provider ports. |
| `db-ops.yaml` | `GET /api/daemon/db`, `POST /api/daemon/db/verify`, `POST /api/daemon/db/vacuum` — gated by a deny-by-default `ToolPolicy`. |
| `delegated-tools.yaml` | `POST /api/delegated-tool-calls` — daemon-side half of the MCP-callback round trip. |
| `tool-catalog.yaml` | `GET /api/tools/search`, `GET /api/tools/:id` — read-only tool discovery, not routed through `ToolExecutor`. |
| `media.yaml` | `POST /api/media/generate` (async), `GET`/`DELETE /api/media/tasks/:id`, `GET /api/media/tasks` — request-now-poll-later. |
| `research.yaml` | `POST /api/research/search` — Tavily wrapper. |
| `routines.yaml` | Routine CRUD, `POST /:id/run`, `GET /:id/runs` — 7 routes. |
| `xai.yaml` | 5 OAuth+PKCE routes plus `POST /api/xai/search`. |
| `remote-run-events.yaml` | `POST /api/runs/:runId/tool-use` / `/tool-result` — behind a dedicated fail-closed bridge-token gate, separate from the general API token. |
| `frontend-sessions.yaml` | `GET /api/frontend-sessions/stream` (SSE, raw primitive) + `POST /api/frontend-sessions/{sessionId}/responses`. |
| `memory.yaml` | 15 routes — tree/index/config CRUD plus `GET /api/memory/events` (SSE, shared channel). |
| `terminals.yaml` | 7 routes — terminal lifecycle plus `GET /api/terminals/{id}/stream` (SSE, the only group with reconnect replay). |
| `model-proxy.yaml` | 5 fixed provider routes + 1 catch-all, POST+SSE, non-uniform per-provider request schemas. |
| `PROGRESS.md` | Exact verified coverage boundary — all known route groups are now documented. |

## Notes worth a second look

- The route manifest is deliberately partial: it advertises proxy-facing health/runs/agents/tool-catalog/delegated-tool families, while `@jini-ai/server` can mount many more built-in feature packs.
- Route-local same-origin checks are uneven by design: mutating operations generally set `requireSameOrigin`, but `GET /api/daemon/status`, agent listing, editor listing, and the run reads do not. The separate global `/api` origin middleware still applies when the host installs it.
- Bearer authentication is host configuration, not an intrinsic route property. When `JINI_API_TOKEN` is configured, `/api/*` gets an optional token gate with explicit probe and loopback exemptions; health/ready/version are intentionally open.
- `/api/daemon/status` exposes `dataDir`, unlike the purpose-built, unauthenticated probe routes. It is described in code as operator detail rather than a health endpoint, but it currently has no route-local same-origin guard.
- Adapter-generated exceptions return a generic `INTERNAL_ERROR` with a correlation id, whereas the host-editor launch route intentionally includes the spawn failure text in its error message after a same-origin request.
- `component-catalog.ts`'s two routes are both `GET`s that nonetheless require same-origin — the only read-only pair found so far gated this way. Every other read-only route audited (`http-kit-core`'s list/get routes, `connectors.ts`'s five provider `GET`s) omits the guard. Not fixed here; worth a human decision on which side is the outlier.
- `component-catalog.ts` is exported, unit-tested, and proxied by `@jini-ai/mcp`'s `search_components`/`describe_component` tools — but `registerComponentCatalogRoutes` is never actually called anywhere in this repo (not `packages/server/src/builtin-features.ts`, not `examples/reference-web`). Those MCP tools have nothing to reach on a daemon built from this repo alone.
- `attachments.ts` is not part of `packages/server/src/builtin-features.ts`'s zero-config mount set either (unlike `connectors.ts`, which is), but for a structural reason rather than an oversight: it needs a concrete `store`/`uploadDirectory`. `examples/reference-web/src/daemon.ts` is the one real (non-test) wiring in this repo.
- `attachments.ts`'s `AttachmentRejectionReason`s mapped to a 500 status (`attachment-body-consumed`, `attachment-integrity`) have specific, actionable source-level messages that a caller never sees — `respondToUploadFailure` redacts them to the generic `INTERNAL_ERROR` shape same as an unclassified exception. Intentional per the source's own comment on `REJECTION_STATUS`, not a bug, but worth knowing before relying on those messages for integration debugging.
- `connectors.ts` is mounted zero-config in `packages/server/src/builtin-features.ts`, which means all 17 routes are live on the wire on a stock daemon and every one answers `503 NOT_CONFIGURED` until a host supplies real `auth`/`storage`/`payments`/`db`/`realtime` providers at its own composition root — there is no separate "connectors disabled" state.
- `db-ops.ts` and `tool-catalog.ts` both require same-origin on every route, including their `GET`s — unlike most read-only routes elsewhere in this API. `media.ts` goes the other way: its two `GET`s are open while `POST`/`DELETE` are gated. Same-origin posture is decided per route pack, not by HTTP method alone; don't assume a pattern from one group carries to another.
- `delegated-tools.ts` returns `200 {result}` for all 6 `ToolExecutionResult` business outcomes (including `denied`/`failed`/`timed-out`), while `db-ops.ts` maps the equivalent outcomes to `403`/`500`. A caller that infers success from HTTP status alone will be wrong against `delegated-tools`.
- `routines.ts` returns `400` (not `404`) for "target project not found" on create/update, inverting the missing-resource convention `tool-catalog.yaml` documents elsewhere in this API.
- `remote-run-events.ts` sits behind its own dedicated `requireRemoteToolBridgeToken` gate (`JINI_REMOTE_TOOL_BRIDGE_TOKEN`) that fails closed if unset — the only route pack found so far where "unset env var" means "deny everything" rather than "gate is open."
- `xai.ts`'s OAuth loopback listener is a process-wide singleton: two concurrent `oauth/start` calls can race, and the second's success silently invalidates the first's already-returned `authorizeUrl`.
- `model-proxy.ts` carries the caller-supplied provider `apiKey` in the JSON POST body, not an `Authorization` header — worth confirming the loopback/same-origin assumption holds before this pack is ever reused over a non-loopback transport.
- The 4 streaming groups do not share one SSE frame shape: `frontend-sessions.ts` uses a raw `createSseResponse` primitive (bare `data:` payload, no `event:`/`id:`, no replay); `memory.ts` and `terminals.ts` use the shared `createSseChannel`, which JSON-stringifies the whole wrapped frame (`{opaqueCursor, kind, data}`) into `data:` and duplicates `opaqueCursor`/`kind` into `id:`/`event:`. Only `terminals.ts` supports Last-Event-ID/`afterCursor` reconnect replay.
- `run-stream.ts` (an alternative run-stream registrar flagged as unresolved in an earlier pass) does not exist in `src/` — it was the `agui-stream` route, deliberately deleted 2026-08-18 after an audit found zero callers anywhere. Not a gap; the real run-events surface is `http-kit-core.yaml`'s `GET /api/runs/{runId}/events`.
