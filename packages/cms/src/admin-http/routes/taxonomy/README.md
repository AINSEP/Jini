# Taxonomy admin route specs

Server-neutral `defineJsonRoute` specs for Categories & Tags (ADR-044). Only the list and
delete-taxonomy routes live here so far; the other taxonomy routes are still host-mounted.

## Wiring

**Provides** — `taxonomyListRoute` (`GET /api/admin/v1/taxonomy`) and `taxonomyDeleteRoute`
(`DELETE /api/admin/v1/taxonomy/:id`, moves the taxonomy to the Trash). Both gate on the domain's
single `admin.taxonomy.manage` permission; delete names the taxonomy id to the authorizer.

**Needs injected** — `TaxonomyListRouteDeps` (`taxonomyRepo`, `termRepo`) and
`TaxonomyDeleteRouteDeps` (`workspaceId`, `taxonomyRepo`, `removeTaxonomy` — the host's Trash
remover — and `clock`).

```ts
mountJsonRoute({
  app,
  spec: { ...taxonomyDeleteRoute, ports },               // host ports: authenticate / authorize / onError
  deps: { workspaceId, taxonomyRepo, removeTaxonomy, clock },
});
```

**Never imports** `express`, `@jini-ai/http-kit` or host code; refusals are `rejectRoute` bodies and
unmapped failures are rethrown to the host's error port. See the package [Wiring](../../../../README.md#wiring)
section for the shared contract.
