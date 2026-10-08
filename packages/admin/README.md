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
| `@jini-ai/admin/react` | Primitives, hooks, shell and entity screens | React and React DOM (optional peers) |
| `@jini-ai/admin/react/shell` | Session gate, panel rendering and persistent assistant slot | React and injected session/navigation |
| `@jini-ai/admin/react/entities` | Schema-driven index, list, detail and create/edit screens | React and injected registry/translation/navigation |
| `@jini-ai/admin/browser/shell-navigation` | Query-preserving History API adapter for the shell | Injected browser window/document/location |

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

const mounted   = resolvePanels({ panels: ALL_PANELS }, { capabilities: wiredPorts, permissions: me.permissions });
const nav       = buildNav({ panels: mounted });
const agentPages = buildAgentPageMap({ panels: mounted });   // pass the RESOLVED set, never the raw one
const route     = matchRoute({ routePath: '/users/u1', panels: mounted });
// -> { panelId: 'users', view: 'user-detail', params: { userId: 'u1' }, query }
```

Route matching is registry-driven: a panel declares its own detail routes and the matcher is
generic. Unregistered paths return `panelId: null` so the shell can fall through to the dashboard,
matching the ported behaviour — a typo should look like a bad URL, not an empty screen.

## Adding host routes

Route groups are host-owned factories taking `({ transport })`. The package ships
contracts and an HTTP transport; it does not ship identity or media route factories.

```ts
import { createAdminClient, createHttpTransport } from '@jini-ai/admin/core';

const transport = createHttpTransport({
  baseUrl: '/api/admin/v1',
  fetch: ({ url }, init) => fetch(url, init),
});
const createStatusRoutes = ({ transport }) => ({
  read: ({}) => transport.request({ path: '/status' }),
});
const client = createAdminClient({ transport, groups: { status: createStatusRoutes } });
await client.status.read({});
await client.transport.request({ path: '/one-off' });
```

`AdminTransport` also supports non-HTTP adapters. Hosts bind authentication,
workspace scope and error handling at that boundary.

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

## Connector integrations

`@jini-ai/admin/server` no longer exists. The former embedded connector backend
was extracted and subsequently removed by the owner. Hosts supply connector data
and authorization through the UI ports; there is no built-in connector vendor
adapter to import. See `@jini-ai/integrations` for the supported webhook and
media-provider capabilities.

## Before writing a panel: check `@jini-ai/ui-core` first

`@jini-ai/ui-core` already models several domains an admin panel would otherwise re-derive —
`execution`, `integrations`, `connectors`, `media-providers`, `notifications`, `appearance`. Reuse
its ports and rules rather than defining a second (or third) version. See that package's README
for the full map and for the `DetectedAgent` drift that motivated this rule.

Panels that reuse `ui-core` take the dependency in `/react/panels/*`. **`/core` stays
zero-dependency** — otherwise every consumer of the contracts layer pulls in 6,000+ lines of
unrelated domain features to get a type.

## API arguments and integration status

Public helpers and factories take a required argument object and an optional
options object. Pass `{}` before optional-only arguments. React props and native
framework callbacks retain their framework contracts.

```ts
hasPermission({ permissions, permission: 'records.read' });
adminHref({ routePath: '/records' }, { base: '/console' });
new AdminApiError({ message: 'Unavailable', status: 503 }, { code: 'unavailable' });
createAdminShellNavigation({ location: window.location, window, document });
```

The shell requires `apiBase`, `workspace`, `adminBase`, `defaultPanelId`,
`railStorageKey`, title, labels, session/navigation ports, panels and slots. A host
supplies every product value. Its session port exposes `read(context)`,
`logout(context)` and `onUnauthenticated({ ...context, onUnauthenticated })`.

Entity screens consume the existing entity port through `EntityRegistryPort` and
require translation and navigation ports. `createEntityPanel({ adminBase,
panelId, navigate, registry, translate }, options)` returns an `AdminShellPanel`.
It contributes list, create, detail and edit routes; agent reachability is opt-in.
Its translation port takes `{ key }`, and `navigate` takes `{ routePath }`.

The HTML editor's direct marker helpers take `{ el }`; its React component adapts
those calls to the upstream editor callbacks. Marker bytes and labels are unchanged.

The export map and barrels include all these slices. The package typecheck includes
test sources and passes after the upstream agentic and UI declarations are rebuilt.
Runtime tests and packing remain deferred under the owner's execution directive. Active owners
must still update Sidebar/RowMenu callers and the entity/menu port APIs before the
package can be released. The integration handoff records the remaining changes.

## Kernel contracts

Admin editor and menu contracts document host integration without repository-specific paths.
`RedirectMatchType` retains `regex` because callers can submit that rejected request shape;
its presence does not imply matcher support. Hosts must verify support before offering it.

## Agent-addressable React controls

React controls keep importing `agentHandle` and `buildAgentListHandles` from
`@jini-ai/agentic`; this is an allowed UI-to-agentic layer dependency. The helpers
have not moved and consumers continue to use their original exports.

Shared React binding helpers are also available from `@jini-ai/admin/core/react`.
This is an explicit browser adapter entry: `@jini-ai/admin/core` and the package
root remain framework free. Domain React entries call these shared helpers
directly, and the existing `react/bind-react` and `react/use-controller` entries
retain their exports through compatibility re-exports. Domain integration
packages are optional peers; install the peers used by the selected entries.
