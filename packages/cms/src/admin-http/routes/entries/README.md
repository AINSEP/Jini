# Entries admin route specs

Server-neutral `defineJsonRoute` specs for Collection entries (ADR-043).

## Wiring

**Provides** — `entryListRoute` (`GET /api/admin/v1/entries?type=`), `entryCreateRoute` (`POST`, 201),
`entryUpdateRoute` (`PUT .../:id`) and `entryLifecycleRoute` (`POST .../:id/lifecycle`).

**Needs injected** — `EntryListRouteDeps` (`workspaceId`, `entryRepo`); the write specs'
`EntryCreateRouteDeps` / `EntryUpdateRouteDeps` / `EntryLifecycleRouteDeps` are `EntriesToolDeps`
(`workspaceId`, `authorize`, `clock`, `idGen`, `outbox`, `entryRepo`, `contentTypeRepo`) plus
`drainOutbox`, the host's inline outbox drain run after a successful write.

```ts
mountJsonRoute({
  app,
  spec: { ...entryCreateRoute, ports },                  // host ports: authenticate / authorize / onError
  deps: {
    workspaceId, authorize, clock, idGen, outbox, entryRepo, contentTypeRepo,
    drainOutbox: () => processOutbox({ outbox, bus, clock }),
  },
});
```

**Never imports** `express`, `@jini-ai/http-kit` or host code. Helpers come from
`../content-types/collections-route.ts`. See the package [Wiring](../../../../README.md#wiring) section for the shared contract.
