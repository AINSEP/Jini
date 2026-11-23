# `admin-http/routes/forms`

Framework-neutral route specs (`defineJsonRoute`) for the admin Forms surface (SPEC-010): definition
list/get/update, the collection-provider listing, and the submission list/get reads. Each spec
answers in core shapes; refusals are thrown as `RouteRefusalError` with the exact flat body the
host writes. Architecture and the injection rules: [extraction plan](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Provides** (one subpath per file):

| subpath | spec | deps type |
|---|---|---|
| `./admin-http/routes/forms/list` | `formsListRoute` | `FormsListRouteDeps` |
| `./admin-http/routes/forms/providers` | `formsProvidersRoute` | `FormsProvidersRouteDeps` |
| `./admin-http/routes/forms/get-by-id` | `formsGetRoute` | `FormsGetRouteDeps` |
| `./admin-http/routes/forms/update` | `formsUpdateRoute` | `FormsUpdateRouteDeps` |
| `./admin-http/routes/forms/list-submissions` | `formsListSubmissionsRoute` | `FormsListSubmissionsRouteDeps` |
| `./admin-http/routes/forms/get-submission` | `formsGetSubmissionRoute` | `FormsGetSubmissionRouteDeps` |
| `./admin-http/routes/forms/resolve-definition` | `resolveFormDefinitionByIdOrSlug` (slug first, id second) | `ResolveFormDefinitionDeps` |
| `./admin-http/routes/forms/write-error` | `formsWriteErrorAnswer` / `rejectFormsWriteError` (forms/core write error -> status + body) | — |

**Inject**: `workspaceId` and the repo picks each `*RouteDeps` names; the host ports supply the
principal (`{ id }`) and the per-request `authorize` guard. `formsProvidersRoute` instead reads the
host's RBAC decision function `deps.authorize` itself, because it answers its own 403 copy.
`formsUpdateRoute` takes the host's audited writes as functions — `updateFormDefinition({ input })`
and `setFormDefinitionStatus({ input })` — with the host's permission, reserved slugs and
authoring already bound.

```ts
mountAdminJsonRoute({ app, spec: formsUpdateRoute, deps: {
  workspaceId, authorize,
  formDefinitionRepo,
  updateFormDefinition: ({ input }) => hostUpdateFormDefinition({ deps: writeDeps(), input }),
  setFormDefinitionStatus: ({ input }) => hostSetFormDefinitionStatus({ deps: writeDeps(), input }),
} }, { failure: { operation: "routes/forms/update", code: "INTERNAL_ERROR" } });
mountAdminJsonRoute({ app, spec: formsListRoute, deps: { workspaceId, authorize, formDefinitionRepo } });
```

Register `formsProvidersRoute` before `formsGetRoute`, so `_providers` never resolves as a form slug.

**Never import** here: `express` or any server framework, `@jini-ai/http-kit`, or host code. Only
`@jini-ai/core` contracts/errors and this package's own modules.
