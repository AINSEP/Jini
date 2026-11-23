# Content-types admin route specs

Server-neutral `defineJsonRoute` specs for the Collections content-type registry (ADR-043).

## Wiring

**Outward error copy.** The write routes (`register`, `update-fields`, `lifecycle`) refuse a mapped write failure through `rejectWriteFailure` (`collections-route.ts`) with the status and code from the domain's status table, but take the `error` text from the REQUIRED `outwardErrorMessage` deps field (`CollectionsOutwardErrorDeps`, `../../http/outward-error-message.ts`). The host binds it at the mount.

**Provides** — `contentTypeListRoute` (`GET /api/admin/v1/content-types`), `contentTypeRegisterRoute`
(`POST`, 201), `contentTypeUpdateFieldsRoute` (`PUT .../:key/fields`) and `contentTypeLifecycleRoute`
(`POST .../:key/lifecycle`). `collections-route.ts` holds the request helpers the entries specs reuse (no content-types runtime import, so entries stay in their own isolation domain); `shared.ts` holds the content-type write deps.

**Needs injected** — each spec's own deps type: `ContentTypeListRouteDeps`, `ContentTypeRegisterRouteDeps`
(adds the host's `registerContentType`, which may pin host-reserved keys), `ContentTypeUpdateFieldsRouteDeps`
(adds `updateContentTypeFields`) and `ContentTypeLifecycleRouteDeps` (adds `drainOutbox`, the host's inline
outbox drain). The write deps carry the host's RBAC `authorize`, which the write services re-check through.

```ts
mountJsonRoute({
  app,
  spec: { ...contentTypeRegisterRoute, ports },          // host ports: authenticate / authorize / onError
  deps: {
    workspaceId, authorize, clock, idGen, outbox,
    contentTypeRepo, contentTypeIndexProvisioner,
    registerContentType,                                  // host registrar
  },
});
```

**Never imports** `express`, `@jini-ai/http-kit` or host code; refusals are `rejectRoute` bodies and
unmapped failures are rethrown to the host's error port. See the package [Wiring](../../../../README.md#wiring)
section for the shared contract.
