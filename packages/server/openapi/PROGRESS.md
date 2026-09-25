# OpenAPI documentation progress

Completed: `http-kit-core.yaml`, verified against `packages/http-kit/src/{adapter,api-security-middleware,health,runs,agents,active-context,host-tools,daemon-status}.ts` and the mounted built-in feature calls in `packages/server/src/builtin-features.ts`.

Completed: `attachments.yaml`, verified against `packages/http-kit/src/attachments.ts` (route pack) plus `packages/http-kit/source-map.md`'s `2026-07-30`/live-verification entries and `examples/reference-web/src/daemon.ts` (the only real wiring in this repo). Notable: this route pack is not mounted by `packages/server/src/builtin-features.ts`'s zero-config default — a host must supply its own `store`.

Completed: `component-catalog.yaml`, verified against `packages/http-kit/src/component-catalog.ts` and `packages/mcp/src/server/tools/component-catalog-tools.ts` (the `search_components`/`describe_component` MCP tools that proxy it over HTTP). Notable: `registerComponentCatalogRoutes` is not called anywhere in this repo (not in `builtin-features.ts`, not in `examples/reference-web`) — the MCP tools that proxy it have nothing to proxy to on a daemon built from this repo alone.

Completed: `connectors.yaml`, verified against `packages/http-kit/src/connectors.ts` (17 routes across 5 provider ports: auth, storage, payments, db, realtime) and its zero-config mount in `packages/server/src/builtin-features.ts`.

Completed: `db-ops.yaml`, verified against `packages/http-kit/src/db-ops.ts`, shared adapter/response/origin plumbing, and `packages/daemon/src/tool-executor.ts` for `ToolExecutionResult`'s real shape. Notable: all 3 routes route through `ToolExecutor` against a deny-by-default `ToolPolicy` — none work until a host supplies its own policy. All 3 (including the read-only `GET`) require same-origin, since `inspect` alone discloses schema/row-count/file-size.

Completed: `delegated-tools.yaml`, verified against `packages/http-kit/src/delegated-tools.ts`. Daemon-side half of the MCP-callback round trip; hands off to `createDelegatedToolBridge`. Notable: all 6 `ToolExecutionResult.status` business outcomes return `200 {result}` — none map to a non-2xx status, unlike `db-ops.yaml`'s explicit 403/500 mapping.

Completed: `tool-catalog.yaml`, verified against `packages/http-kit/src/tool-catalog.ts`. Read-only, deliberately not routed through `ToolExecutor` (discovery isn't permission). Notable: both `GET`s require same-origin, deviating from the general "GETs are open" pattern; `GET /api/tools/:id` was fixed from an incorrect `400` to the correct `404` for an unknown id on 2026-07-29.

Completed: `media.yaml`, verified against `packages/http-kit/src/media.ts`. Async request-now-poll-later shape: `POST /api/media/generate` (202, background task), `GET`/`DELETE /api/media/tasks/:id`, `GET /api/media/tasks`. Notable: the two `GET`s do not require same-origin while `POST`/`DELETE` do — the opposite asymmetry from `db-ops.yaml`/`tool-catalog.yaml`'s "gate every GET" posture.

Completed: `research.yaml`, verified against `packages/http-kit/src/research.ts`. `POST /api/research/search`, a Tavily wrapper. 1 route.

Completed: `routines.yaml`, verified against `packages/http-kit/src/routines.ts`. 7 routes: routine CRUD plus `POST /:id/run` and `GET /:id/runs`. Notable: "target project not found" on create/update returns `400`, not `404`, inverting the usual missing-resource convention documented in `tool-catalog.yaml`.

Completed: `xai.yaml`, verified against `packages/http-kit/src/xai.ts`. 6 routes: 5 OAuth+PKCE dance routes plus `POST /api/xai/search`. Notable: the loopback OAuth port is a process-wide singleton — concurrent `oauth/start` calls serialize, and a second call's success can silently invalidate a first call's already-returned `authorizeUrl`.

Completed: `remote-run-events.yaml`, verified against `packages/http-kit/src/remote-run-events.ts`. `POST /api/runs/:runId/tool-use` and `/tool-result`. Notable: both sit behind a dedicated `requireRemoteToolBridgeToken` middleware (`JINI_REMOTE_TOOL_BRIDGE_TOKEN`) — a separate trust boundary from `requireSameOrigin` and the general `/api` bearer gate — that fails closed unconditionally (unset token means every request gets 503, never silently open). Its hand-written 401/503 responses bypass the shared `statusForError` table entirely.

Completed: `frontend-sessions.yaml`, verified against `packages/http-kit/src/frontend-sessions.ts`. `GET /api/frontend-sessions/stream` (SSE) + `POST /api/frontend-sessions/{sessionId}/responses`. Notable: built on the raw `createSseResponse` primitive, not the shared `sse.ts` channel the other 3 streaming groups use — bare `data: <json>` frames, no `event:`/`id:` fields, no Last-Event-ID replay.

Completed: `memory.yaml`, verified against `packages/http-kit/src/memory.ts`. 15 routes (overview, tree read/patch, index PUT, config PATCH, events SSE, extraction/verification history, entry CRUD). Notable: `GET /api/memory/events` multiplexes `connected`/`change`/`extraction`/`verify` over the shared `createSseChannel`, no replay (source emitters don't buffer history); `POST /api/memory` (create) returns `200`, not `201` like `POST /api/runs`/`POST /api/terminals` — worth confirming intentional.

Completed: `terminals.yaml`, verified against `packages/http-kit/src/terminals.ts`. 7 routes (list/create/stdin/resize/kill/delete/stream). Notable: `GET /api/terminals/{id}/stream` is the only one of the 4 SSE groups that supports Last-Event-ID/afterCursor reconnect replay; `principal` is a single fixed host-supplied value for the whole daemon process, so "sessions the caller owns" is scoped to that one identity, not per-tab/per-user.

Completed: `model-proxy.yaml`, verified against `packages/http-kit/src/model-proxy.ts`. 5 fixed provider routes plus 1 `:provider` catch-all, all POST+SSE. Notable: request shape is confirmed non-uniform per provider (Anthropic requires `maxTokens`; Azure additionally requires `baseUrl`+`apiVersion`; Google uses `maxOutputTokens`; Ollama requires `apiKey` despite "local" reputation) — modeled as separate request schemas rather than one lax shared shape; the credential (`apiKey`) travels in the JSON body, not an `Authorization` header.

All groups from the original scan are now documented. `Agent runtime` (`mmd-routes.ts`) was checked and has no HTTP route registration — nothing to document there.

`run-stream.ts` — **resolved, not a gap.** It does not exist anywhere in `src/`; it only survives as stale `dist/` build output and an unrelated internal label string in `runs.ts`. It was the `agui-stream` route (`RUN_STREAM_ROUTE_PATH`/`registerRunStreamRoute`/`handleRunStreamRequest`), deliberately deleted per `.changeset/remove-agui-stream-route.md` after a 2026-08-18 audit found zero callers anywhere (no client in this repo or Tovu, never published to npm). The real, current run-events surface is `GET /api/runs/{runId}/events`, already documented in `http-kit-core.yaml`.

Cross-cutting note across the 4 SSE groups (`frontend-sessions`, `memory`, `terminals`, `remote-run-events` is not SSE despite the name): the shared `createSseChannel`'s `data:` field JSON-stringifies the entire wrapped frame (`{opaqueCursor, kind, data}`), not just the payload — `opaqueCursor`/`kind` are duplicated into the frame's own `id:`/`event:` fields too. `frontend-sessions.ts`'s raw-SSE primitive does not do this (bare payload only). Do not assume all streaming groups share one SSE frame shape.
