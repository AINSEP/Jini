# @jini-ai/http-kit

A toolkit of composable Express route packs and a JSON-route transport for a `@jini-ai/core`
daemon composition: request parsing, response serialization, a same-origin guard, SSE streaming,
and a ready-to-mount set of kernel route packs (runs, agents, memory, routines, terminals, and
more). This package does **not** open a listener itself — a host (your own Express app, or
`@jini-ai/server`'s `createLocalNodeDaemon`, which is the one assembled preset that does bind a
port) mounts these route-registrars onto its own `app`.

## Install

```sh
npm install @jini-ai/http-kit express
```

`express` is a regular dependency (`^4.21.0`) pulled in automatically; you still need it installed
in your own app if you're calling its types directly. `@jini-ai/agent-runtime`, `@jini-ai/core`,
`@jini-ai/daemon`, `@jini-ai/platform`, and `@jini-ai/protocol` are also regular dependencies — no
optional peers.

## What you get

- **Route-spec primitives** — `JsonRouteSpec`/`InputParser`/`Handler`/`HttpMethod`/
  `RouteInputContext`, the `Result<T, E>` envelope (`ok`/`err`), and `defineJsonRoute`/
  `mountJsonRoute` (the Adapter — the only code here that touches Express `req`/`res` directly).
- **Origin and auth guards** — `origin-validation`'s host/origin classifiers
  (`isLocalSameOrigin`, `isAllowedBrowserOrigin`, `parseHostHeader`, `isPrivateIpv4`, ...),
  `registerApiBearerAuthMiddleware`/`registerApiOriginGuardMiddleware`, and
  `requireLocalDaemonRequest`/`validateLocalDaemonRequest` for daemon-local-only routes.
- **Streaming** — `createSseChannel` (cursor-replayable SSE with a bounded queue) and
  `createSseResponse` (raw, unbuffered SSE, used by the frontend-session stream).
- **Pack composition glue** — `mountPackHttp(app, packs, daemon)` calls every composed
  `@jini-ai/core` pack's own `http(app, services)` registrar with the services `createDaemon`
  already resolved for it; `cancelRunsOwnedBy` and `installRouteRegistrationGuard`/
  `getRouteRegistrationInventory` (duplicate-route detection) support that composition.
- **Daemon lifecycle routes** — `registerDaemonStatusRoutes` (`daemonStatusRoute`,
  `daemonShutdownRoute`) and `registerHealthRoutes` (`/health`, `/ready`, `/version` and their
  `/api`-prefixed twins — deliberately open, unauthenticated probes).
- **Kernel route packs, ready to mount** — one `register*Routes` function per concern: runs
  (`registerRunRoutes`), agents (`registerAgentRoutes`), memory (`registerMemoryRoutes`),
  routines (`registerRoutineRoutes`), terminals (`registerTerminalRoutes`), db-ops
  (`registerDaemonDbRoutes` + tool registrations), tool catalog (`registerToolCatalogRoutes`),
  delegated tools (`registerDelegatedToolRoutes`), remote run events
  (`registerRemoteRunEventRoutes`), frontend sessions (`registerFrontendSessionRoutes`), active
  context (`registerActiveContextRoutes`), host tools (`registerHostToolsRoutes`), model proxy
  (`registerModelProxyRoutes`), connectors — auth/db/payments/storage/realtime provider seams
  (`registerConnectorsRoutes`), research (`registerResearchRoutes`), media
  (`registerMediaRoutes`), and xai (`registerXaiRoutes`). Each exports its own `*HttpDeps` type so
  you inject exactly the backing services it needs.
- **Workspace root resolution** — `resolveWorkspaceRoot`/`denyAllWorkspaceRoots`/
  `WorkspaceRootDeniedError`.
- **Legacy-shaped compat errors** — `createCompatApiError`/`createCompatApiErrorResponse`/
  `sendCompatApiError`, a `(code, message, init)` call shape kept alongside the main `ApiError`
  envelope for call sites generated against the older shape.

## Usage

```ts
import express from 'express';
import {
  defineJsonRoute,
  mountJsonRoute,
  registerHealthRoutes,
  ok,
  type AdapterContext,
} from '@jini-ai/http-kit';

const app = express();
app.use(express.json());

const adapter: AdapterContext = { resolvedPortRef: { current: 4000 } };

// Ready-to-mount kernel routes: GET /health, /ready, /version (+ /api-prefixed twins).
registerHealthRoutes(app, { getVersion: () => '1.0.0' }, adapter);

// A custom route built on the same Result/JsonRouteSpec pipeline.
const echoRoute = defineJsonRoute<{ msg: string }, { echoed: string }, void>({
  method: 'post',
  path: '/echo',
  parse: (raw) => ok({ msg: String((raw.body as { msg?: unknown })?.msg ?? '') }),
  handle: (input) => ok({ echoed: input.msg }),
});
mountJsonRoute(app, echoRoute, undefined, adapter);

app.listen(4000);
```

## What's swappable

Every route pack takes its backing services as an injected `*HttpDeps` object (e.g.
`HealthHttpDeps.getVersion`/`checkReadiness`, `RunHttpDeps`, `MemoryHttpDeps`) rather than reaching
for a global — swap in whatever implementation your host provides. `JsonRouteSpec.parse`/`handle`
are themselves the seam for a fully custom route. Fixed and not meant to be replaced: the Express
mounting mechanics in `adapter.ts` (this package does not support a non-Express framework — a
prior switchable Fastify transport was removed on 2026-07-22; see `source-map.md` and
`FASTIFY-TRANSPORT-PARKED.md` on the `future/fastify-transport` branch if reviving it), and the
`Result`/`ApiError` error-handling pipeline every route folds into.

## Runtime

`jini.runtime: "node"` — mounts onto a real Express `app`, uses Node's `express` types throughout.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
