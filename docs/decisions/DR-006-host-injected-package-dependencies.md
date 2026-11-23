# DR-006: Packages receive implementations from the host

Status: Accepted owner direction, 2026-11-22. This record defines the target for CI enforcement.

## Context

A feature can have its own folder and still depend on a host’s route types, transport, or live hooks. A package graph can be acyclic and still lock consumers into another package’s implementation. A value import fixes a choice the host should make. This decision extends the composition rule in [DR-005](DR-005-portable-package-boundaries.md).

## Decision

1. **Jini owns reusable behavior.** Packages stay product-, vendor-, and server-framework-neutral. A host product owns its policy, themes, copy, and concrete wiring. Split mixed code at the seam and move the reusable behavior with its why-comments. Consumers use the owning public export. Delete forwarding-only compatibility files.
2. **The consuming feature owns its port.** Each feature declares only the operations and data it uses. It receives implementations as arguments or props and keeps host infrastructure and sibling implementation imports out of its source. Shared generic types and ports live in `@jini-ai/core`. New files under Core’s `src/contracts` hold types only. New runtime code goes at its owning implementation path. Host-specific types stay in the host.
3. **Routes publish specs.** Define server-neutral JSON specs with `defineJsonRoute` from `@jini-ai/core/contracts/server`. Each spec uses a small route-local deps type and leaves `ports` unset. The host builds the route with `jsonRoute` and registers it on its `Server`, adding its request policy and failure mapping. `mountJsonRoute` in `@jini-ai/http-kit` is the Express compatibility adapter. A central deps type or a `Pick` from one ties the spec to a host.
4. **Screens receive UI and behavior through declared inputs.** Use the host-injected `@jini-ai/admin` kit for shared admin UI. Custom React hooks arrive as required props typed to the fields and calls the component uses. Use neutral prop names and keep live bindings in host composition. Take product copy through existing args or props fields.
5. **Keep effects and call shapes explicit.** Inject logging and provider operations. Keep console calls, Express types and code, vendor implementations, and host identity out of feature code. Existing Express compatibility subpaths are tracked debt. Public functions and factories take `(requiredArgs, optionalArgs)` objects and keep `_optional = {}` when the second object has no fields. Function length warns at 50 lines and errors above 80. Complexity is capped at 10.

## Consequences and current limits

Hosts can choose different providers and server adapters while keeping the same feature. Tests can supply small fakes. The host has more wiring to write, and package authors must keep contracts narrow. Remove legacy compatibility entries and import debt as their consumers migrate.

## Defect prevented

A reusable package silently selects a sibling implementation, or a screen’s default hook reaches into host transport even when the screen has an injection prop.

## Source and enforcement

CI tracks resolved occurrences against the trusted base. New violations, expanded allowances, and stale debt entries fail the check.

- **C — Cross-package boundary.** Reject new sibling executable imports and shared type imports outside the base packages. Allow public Core types and approved Core runtime exports listed with the debt file. Protocol keeps base-package status under the same public-entry rules. Check resolved source, declarations, and manifests.
- **D1–D4.** Reject forwarding shells, concrete or defaulted custom hooks, console/Express/vendor dependencies and host identity, and growth in size exceptions. Canonical same-package public entry points remain valid.
- Host repositories can add matching checks for their side of the boundary.

Each feature folder’s `INFO.md` or `README.md` has a **Wiring** section. It lists what the feature needs, what it provides, a short host wiring example, and what it must not import, and links to this record. CI also checks that the ports it names exist. The agent that untangles or moves the feature writes the section in the same change.

[Core route spec](../../packages/core/src/contracts/server/json-route.ts) · [Admin kit](../../packages/admin/src/react/kit.tsx) · [Cross-package check](../../scripts/check-no-cross-package.ts) · [Hardwiring check](../../scripts/check-hardwiring.ts)

## How to wire a feature

The package declares a local route port and a screen that consumes a narrow hook result. `Notice` comes from the admin kit.

```ts
import { defineJsonRoute, type Result } from '@jini-ai/core/contracts/server'

type MenuRouteDeps = {
  readMenu: (required: { id: string }) => Promise<Result<{ title: string }>>
}

export const menuRoute = defineJsonRoute<
  { id: string }, { title: string }, MenuRouteDeps
>({
  method: 'get',
  path: '/menus/:id',
  parse: parseMenuId,
  handle: ({ input, deps }, _optional = {}) => deps.readMenu({ id: input.id }),
})
```

```tsx
import { Notice } from '@jini-ai/admin/react/kit'

type MenuScreenProps = {
  id: string
  heading: string
  useMenu: (required: { id: string }) => { title: string }
}

export function MenuScreen({ id, heading, useMenu }: MenuScreenProps) {
  const { title } = useMenu({ id })
  return <Notice>{heading} {title}</Notice>
}
```

The host registers the route on its `Server` and mounts the screen with its selected kit, hook, and copy. In this wiring sketch the menu reader, route ports, and incident reporter are supplied by the host.

```tsx
import { defineJsonRoute, jsonRoute, type Server } from '@jini-ai/core/contracts/server'
import { AdminKitProvider } from '@jini-ai/admin/react/kit'

function registerMenu({ app }: { app: Server }, _optional = {}) {
  const spec = defineJsonRoute(menuRoute, { ports: hostRoutePorts })
  const deps = { readMenu: readAllowedMenu }
  const host = routeHost

  app.route(jsonRoute({ spec, deps, reportInternalError }, { host }))
}

<AdminKitProvider kit={adminKit}>
  <MenuScreen id={menuId} heading={menuHeading} useMenu={useWiredMenu} />
</AdminKitProvider>
```

## Alternatives rejected

- **A central dependency module for everything.** A shared implementation hub couples every consumer to the same graph. Core supplies shared vocabulary and approved neutral primitives.
- **Import implementations and expose defaulted overrides.** The import fixes a production dependency and hides a choice the host should make.
