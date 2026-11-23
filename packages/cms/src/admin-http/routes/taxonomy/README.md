# Taxonomy admin route specs

Server-neutral `defineJsonRoute` specs for Categories & Tags (ADR-044). Every plain taxonomy route
lives here; only the gated merge-term ceremony is still host-mounted.

## Wiring

**Provides**

| spec | route | answers |
|---|---|---|
| `taxonomyListRoute` | `GET /api/admin/v1/taxonomy` | `{ items }` |
| `taxonomyCreateRoute` | `POST /api/admin/v1/taxonomy` | 201 `{ taxonomy }` |
| `taxonomyCreateTermRoute` | `POST /api/admin/v1/taxonomy/:taxonomyId/terms` | 201 `{ term }` |
| `taxonomyRenameTermRoute` | `PUT /api/admin/v1/taxonomy/terms/:id` | `{ term }` |
| `taxonomyAssignTermsRoute` / `taxonomyUnassignTermsRoute` | `POST /api/admin/v1/taxonomy/{assign,unassign}-terms` | 204 |
| `taxonomyAssignedTermsRoute` | `GET /api/admin/v1/taxonomy/assigned-terms` | `{ termIds }` |
| `taxonomyDeleteRoute` / `taxonomyDeleteTermRoute` | `DELETE /api/admin/v1/taxonomy/:id`, `.../terms/:id` | `{ trashed, id, version }` |

All gate on the domain's single `admin.taxonomy.manage` permission. List and the two deletes use the
host's authorize port (deletes name the entity id). The write and assignment routes authorize inside
the taxonomy write service through the injected `authorize` (the host's workspace-scoped RBAC
authorizer, which the specs bind to `workspaceId`), so a denial answers the flat
`{ error, code: "FORBIDDEN" }` 403; tagging also checks the content's own edit permission.

**Needs injected**

- `TaxonomyListRouteDeps` — `taxonomyRepo`, `termRepo`.
- `TaxonomyDeleteRouteDeps` / `TaxonomyDeleteTermRouteDeps` — `workspaceId`, the trash read repo
  (`taxonomyRepo` / `termRepo`), the host's Trash remover (`removeTaxonomy` / `removeTerm`), `clock`.
- `TaxonomyWriteRouteDeps` (= `TaxonomyCreateRouteDeps`, `TaxonomyCreateTermRouteDeps`) — `workspaceId`,
  `authorize`, `clock`, `idGen`, `outbox`, `taxonomyRepo`, `termRepo`, `entryTermRepo`,
  `taxonomyRevisionRepo`, `stampWatermark`, `postRepo`. `TaxonomyRenameTermRouteDeps` adds a
  `taxonomyRepo` that opens the shared `transaction`; `TaxonomyAssignTermsRouteDeps` adds
  `entryRepo`, `contentTypeRepo` and an `entryTermRepo` that can also unassign and `listForContent`.

```ts
mountJsonRoute({
  app,
  spec: { ...taxonomyCreateTermRoute, ports },          // host ports: authenticate / authorize / onError
  deps: { workspaceId, authorize, clock, idGen, outbox, taxonomyRepo, termRepo,
          entryTermRepo, taxonomyRevisionRepo, stampWatermark, postRepo },
});
```

**Never imports** `express`, `@jini-ai/http-kit` or host code. Refusals are `rejectRoute` bodies (the
term-delete 409 carries an extra `count`, so it throws `RouteRefusalError` with that exact body);
unmapped failures are rethrown to the host's error port, which owns logging. See the package
[Wiring](../../../../README.md#wiring) section for the shared contract.
