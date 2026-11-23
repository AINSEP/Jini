# `@jini-ai/cms/media/site/*`

Site-level media commands and helpers extracted from a host CMS. Each module is its own
`@jini-ai/cms/media/site/<name>` subpath; there is no barrel. Rationale for the split lives in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

### `import-media-entity`

`importMediaEntity` writes an imported media row under its SOURCE id (never a freshly minted
one) and `restoreImportedMedia` undoes it. It needs one deps object, `ImportMediaEntityDeps`:

- `mediaRepo: VersionedMediaRepoPort` — compare-and-set media rows (`insertIfAbsent` / `saveIfVersion`).
- `assetBlobRepo: AssetBlobRepoPort`, `blobStore: BlobStorePort` — content-addressed bytes.
- `clock: { nowIso(): string }`, `idGen: { newId(): string }` — only for a new blob row's id.

It provides `ImportMediaEntityResult` (`imported` | `blocked` | `conflict`); every refusal is a
typed result, and only unexpected storage failures throw.

```ts
import { importMediaEntity } from "@jini-ai/cms/media/site/import-media-entity";

const result = await importMediaEntity({
  deps: { mediaRepo, assetBlobRepo, blobStore, clock, idGen },
  input: { workspaceId, record, bytes, blobCreatedByPrincipal: principalId, baseVersion: expectedVersion ?? null },
});
if (result.status !== "imported") return result; // the host maps blocked/conflict to its own report
```

These modules must never import host code (routes, composition roots, product tool catalogs),
an HTTP framework, or a host logger; host collaborators arrive through the deps object.
