# Entries admin route specs

Server-neutral `defineJsonRoute` specs for Collection entries (ADR-043).

## Wiring

**Outward error copy.** The write routes (`create`, `update`, `lifecycle`) refuse a mapped write failure through `rejectWriteFailure` (`../content-types/collections-route.ts`) with the status and code from the domain's status table, but take the `error` text from the REQUIRED `outwardErrorMessage` deps field (`CollectionsOutwardErrorDeps`). The host binds it at the mount.

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
