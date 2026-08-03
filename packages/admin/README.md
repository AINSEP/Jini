# `@jini-ai/admin`

A composable admin surface for Jini-hosted products. A host picks the panels it wants, wires the
ports those panels need, and gets a working admin — sidebar, routing, and agent-navigation
allowlist all derived from one declaration.

Extracted from the reference implementation's admin SPA, which had grown a 1,548-line API client
with 134 methods in a single object and defined every section across three files that had to be
kept in sync by hand.

## Layers

Import only what you need. `sideEffects: false` plus per-layer subpaths means an unused layer is
not in your bundle.

| Subpath | Contains | Needs |
|---|---|---|
| `@jini-ai/admin/core` | contracts, panel registry, route matching, transport, ports | nothing |
| `@jini-ai/admin/browser` | `window`-bound navigation, link interception | a DOM |
| `@jini-ai/admin/server` | Composio integration: catalog, OAuth, tool execution | Node.js |
| `@jini-ai/admin/react` *(partial)* | `Sidebar` + its rail hook; panels not built yet | React (optional peer) |

`/core` is the layer a panel author codes against: no React, no DOM, no I/O. That boundary is
enforced at runtime — this package's vitest config runs `src/core/**` without a jsdom environment,
so a `window` reference in core fails loudly instead of passing quietly.

React and react-dom are **optional** peer dependencies (`peerDependenciesMeta`), so a consumer
importing only `/core` is not asked to install them.

## A panel

```ts
import type { AdminPanel } from '@jini-ai/admin/core';

export const usersPanel: AdminPanel<() => ReactNode> = {
  id: 'users',
  render: () => <Users />,
  nav: { label: 'Users', group: 'People', order: 1 },
  requires: ['identity'],          // dropped entirely if no identity port is wired
  permissions: ['users.read'],     // affordance only — never the authz boundary
  agentReachable: true,            // explicit opt-in; defaults to false
  routes: [{ pattern: '/:userId', view: 'user-detail' }],
};
```

Three properties carry decisions worth not re-deriving:

- **`nav` is optional.** A panel can be routable without a sidebar row (the reference
  implementation's `appearance` and `settings-raw` panels both rely on this).
- **`agentReachable` defaults to `false` and must stay an explicit opt-in.** It is the allowlist
  behind `page.navigate`-style capabilities. Deriving it from panel registration would make every
  new screen agent-reachable as a side effect of existing, which inverts the point of an
  allowlist. An AI generating a panel manifest cannot make itself reachable by omission.
- **`requires` is how a host composes.** You do not ship or omit panel *code*; you supply or
  withhold the *ports* a panel names, and unmet panels vanish — no dead nav row, no route that
  renders an error.

## Assembling a shell

```ts
import { resolvePanels, buildNav, buildAgentPageMap, matchRoute } from '@jini-ai/admin/core';

const mounted   = resolvePanels(ALL_PANELS, { capabilities: wiredPorts, permissions: me.permissions });
const nav       = buildNav(mounted);
const agentPages = buildAgentPageMap(mounted);   // pass the RESOLVED set, never the raw one
const route     = matchRoute('/users/u1', mounted);
// -> { panelId: 'users', view: 'user-detail', params: { userId: 'u1' }, query }
```

Route matching is registry-driven: a panel declares its own detail routes and the matcher is
generic. Unregistered paths return `panelId: null` so the shell can fall through to the dashboard,
matching the ported behaviour — a typo should look like a bad URL, not an empty screen.

## Adding your own routes alongside the shipped ones

Every route group is `(transport) => port`. Jini's and yours are the same shape, so they compose
into one client with one auth policy, one error class, and one place to add retries or tracing:

```ts
import { createAdminClient, createHttpTransport } from '@jini-ai/admin/core';

const transport = createHttpTransport({ baseUrl: '/api/admin/v1' });

const client = createAdminClient(transport, {
  identity: createIdentityRoutes,   // shipped by @jini-ai/admin
  media:    createMediaRoutes,      // shipped by @jini-ai/admin
  posts:    createHostPostRoutes,   // yours, same signature
  widgets:  createHostWidgetRoutes, // yours
});

await client.identity.listUsers();
await client.posts.list();
await client.transport.request('/one-off');   // escape hatch for un-wrapped routes
```

`AdminTransport` is an interface rather than a bare function so a host can supply a non-HTTP
implementation — an in-process direct dispatch for a multi-instance runner, or a fixture-returning
fake in tests — without any route group knowing.

## Errors

Route groups throw `AdminApiError` (`status`, `code`, raw `body`). There is deliberately **no**
shared code-to-message table: the same `code` means genuinely different things in different
domains, and a shared table could only pick one. `describeApiError` is the base case only; panels
layer their own per-code copy on top and fall through to it.

## Not a security boundary

`hasPermission` and a panel's `permissions` decide whether a control renders. They never run on
the server. A bug here can only show or hide a control; it cannot grant or block the underlying
operation, because every mutation must be independently re-checked server-side. Do not import
these into server code.

## `/server`: Composio integration

`@jini-ai/admin/server` was `@jini-ai/composio`, a standalone package, until it was folded in here
as a subpath (see `src/server/composio/source-map.md` for the full provenance and security-model writeup).
It was never a standalone concern — its only consumer was ever going to be an admin surface, so a
separate vendor-adapter package bought nothing but an extra install/version boundary. Unlike
`/core` and `/browser`, it is Node-only (`node:fs`, `node:crypto`, `node:path`) and does **not**
share a runtime with either of them — that is why it is not under `/core` despite being
framework-free, and why it gets its own `jini.entries` runtime (`"node"`).

```ts
import {
  ComposioConnectorProvider,
  ComposioConnectorService,
  ConnectorStatusService,
  FileConnectorCredentialStore,
  createFileComposioConfigStore,
} from '@jini-ai/admin/server';

const configStore = createFileComposioConfigStore({
  filePath: '/var/lib/example/composio/config.json',
});
const credentialStore = new FileConnectorCredentialStore({
  filePath: '/var/lib/example/composio/credentials.json',
});
const provider = new ComposioConnectorProvider({
  userId: 'user_123',
  configStore,
  catalogCachePath: '/var/lib/example/composio/catalog-cache.json',
});
const service = new ComposioConnectorService({
  provider,
  statusService: new ConnectorStatusService({ credentialStore }),
});
```

It is headless: no HTTP routes, no UI code, no assumed host layout. A host injects the user id,
config store, fetch implementation, cache path, and optional curation data. Connected-account
ownership, connector/toolkit/auth-config state, and credential evidence are all revalidated before
execution or disconnection — a provider-reported connected state alone is never sufficient. See
`src/server/composio/source-map.md` for the full boundary list (schema validation, output bounding, secret
file handling, locking) and the accepted live-credential E2E gap.

## Before writing a panel: check `@jini-ai/ui-core` first

`@jini-ai/ui-core` already models several domains an admin panel would otherwise re-derive —
`execution`, `integrations`, `connectors`, `media-providers`, `notifications`, `appearance`. Reuse
its ports and rules rather than defining a second (or third) version. See that package's README
for the full map and for the `DetectedAgent` drift that motivated this rule.

Panels that reuse `ui-core` take the dependency in `/react/panels/*`. **`/core` stays
zero-dependency** — otherwise every consumer of the contracts layer pulls in 6,000+ lines of
unrelated domain features to get a type.

## Status

Slice 1: `/core` and `/browser`, 76 tests. `/server` (folded in from `@jini-ai/composio`
2026-08-01): 123 tests, 100% statement/branch/function/line coverage. `/react` holds only
`Sidebar` and `useSidebarRail`; the panels and `<AdminShell>` are not built yet, and of the twelve
planned ports only `AdminIdentityPort` is specified.

`/react` used to also carry `ConfirmButton`, `ConfirmDialog`, `DataTable` and `RowMenu`. They moved
to `@jini-ai/ui` on 2026-08-03 (import them from there): none of them knew anything about admin
panels, so they were generic chrome shipping under this package's name. `Sidebar` stayed because it
genuinely reads `/core` — it renders `buildNav`'s `AdminNavGroup[]` and resolves item links through
`adminHref` — and `useSidebarRail` stayed with it rather than make this package depend on
`@jini-ai/ui` (and that package's dependency tree) just to render its own sidebar.
