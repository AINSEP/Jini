# Daemon API

Session-store test repairs keep the public API unchanged: packed-consumer helpers are package-local, and raw SQLite connections use their driver's zero-argument `close()`.

Runtime parser feeds and event sinks use their current object arguments (`feed({ chunk })`, `send({ event, payload })`), and stdout sanitizers receive `{ fullText }`. Optional fields are omitted when absent, preserving explicit `null` session values. Run streams supply `onEvent`; tool handlers receive `emitSurface` in their optional argument object.

## HTTP integration and execution policy

Import route packs from `@jini-ai/daemon/http`; generic HTTP parsing, response writers,
origin guards and `AdapterContext` remain in `@jini-ai/http-kit`. Install the optional peers
`@jini-ai/http-kit` and `express` when using the HTTP entry. The root daemon runtime and
read-only policy entry do not load HTTP or Express.

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

Every route pack injects its backing services through its `*HttpDeps` object; the host
can replace the service without changing HTTP mounting. The route inventory is derived from
these live specs, so proxy allowlists track path changes without hand-copied strings.
Most registrars use `registerRoutes({ app, deps, adapter })`; host tools use
`registerHostToolsRoutes({ app, adapter }, openInDeps)`.

Import the execution gate from `@jini-ai/daemon/read-only-tools`:

The entry exports
  `withReadOnlyToolConstraint({ inner, registry, idGenerator, messages })` and
  `constrainPrincipalToReadOnlyTools({ principal })`. Messages require
  `unverifiableMessage` and `toolRefusalMessage({ toolId })`; IDs come from
  `idGenerator.newId()`. Compose the gate innermost, beneath decorators that may
  dispatch recovery tools. Unknown/unclassified registrations and an absent
  registry refuse constrained dispatches. `refuseNonReadOnlyDispatch` supports
  preflight before a recovery UI is raised, and `readOnlyRemedyRefusalMessage`
  accepts `{ refusal, formatMessage }` for host-formatted recovery explanations.


`defaultDaemonMessages.readOnly` preserves the gateway's refusal wording and can be replaced
by the host. The old delegated-tool facades are removed. Core `IdGenerator.newId()` supplies
IDs. Executor calls use `execute({ principal, run, toolId, input }, { signal, emitSurface })`;
controls use their required argument objects.

Payment transports retain the JSON `description` field but call the provider with
`charge({ amountCents, currency, customerRef }, { description? })`. Media transports
retain the JSON request shape but call the engine with `generate({ surface, model },
generationOptions)`. Realtime subscription handlers receive `{ event }`.

For run credentials, bind `authorizeDaemonRequest`'s environment, route, crypto,
credential and header policy outside this package; the Express adapter passes a
normalized request and the delegated-body validation option. Bind
`authorizeRunOwnership` and `listOwnedRuns` similarly. The first gate does not read
the body. Allowed run credentials overwrite the principal header with verified
identity; trusted proxy headers remain intact. Denial statuses and bodies pass
through unchanged. Exceptions go to Express's error middleware.


Run credentials, session coordination, held surface exchanges, scheduling and tool auditing
have concept-named subpaths (`./run-credentials`, `./session-coordination`, `./surface-exchanges`,
`./scheduler`, `./tool-audit`). `createSurfaceExchangeStore` receives `clock: Clock` and
`idGenerator: IdGenerator` alongside the scheduler and required channel policy.
The Node credential adapter uses core's UTF-8 token comparison with native constant-time equality.

`createInMemoryEventLog({}, { maxEntriesPerRun, now })`, `createRunByteJournal({ eventLog })`
and `createInMemoryRoutineStore({}, { now, newId })` use the reconciled object APIs.
