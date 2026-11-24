# `@jini-ai/cms/media/site/*`

Site-level media commands and helpers extracted from a host CMS. Each module is its own
`@jini-ai/cms/media/site/<name>` subpath; there is no barrel. Rationale for the split lives in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- `list-pending-chat-attachments` — `buildListPendingChatAttachmentsTool({ ... })` takes the host's
  attachment lookup (typed on `@jini-ai/core/contracts/site/daemon-http`'s `PendingAttachmentSummary`);
  the host composition module registers the returned tool.

- `provider-credential-contracts` — types only: `MediaProviderCredentialRecord`, `MediaProviderCredentialRepoPort`
  and the replace-plan types. `sealed` is `@jini-ai/core/contracts/vault`'s `SealedSecret`; the host supplies the
  vault-backed repo and the sealer.
- `view-image-tool` — `contributeMediaViewImageTools({ mediaAssetReadToolId })` /
  `buildMediaViewImageRegistrations({ deps, mediaAssetReadToolId })` / `buildMediaViewImageAgentToolCatalog({ mediaAssetReadToolId })`.
  `mediaAssetReadToolId` is the host's read tool id for one media asset (named in the description and the
  not-found refusal; the catalog is built per call, never held as module state). The host's
  deps carry `mediaRepo`, `assetBlobRepo`, `blobStore`, `authorize`, `workspaceId` and an `imageCodec: ImageCodecPort`
  (no codec means the tool refuses rather than loading a native vendor itself).
- `duplicate-asset` — `contributeMediaDuplicateHandlers({ deriveDuplicateName })` / `duplicateMediaAsset({ routeDeps,
  deriveDuplicateName, ... })`: `content_duplicate`'s `"media"` resource. The host injects its content-duplication naming
  policy (`DeriveDuplicateName`) for a copy's default title; `routeDeps` is `MediaToolDeps & MediaPublicUrlDeps`.

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

### The other modules

Ports and record types (`AssetBlobRepoPort`, `BlobStorePort`, `ImageCodecPort`, `MediaRecord`) come
from `@jini-ai/cms/media`. Each subpath below is a plain function or port; the host builds the
adapters and passes them in.

| Subpath | Needs injected | Provides |
| --- | --- | --- |
| `bootstrap` | `RegisterTransformDeps` (`clock`, `idGen`, `transformRepo`) and a `workspaceId` | `ensureCoreMediaTransform`, `CORE_PUBLIC_TRANSFORM_NAME` |
| `chat-preview` | `routeDeps.imageCodec?: ImageCodecPort` (absent means no preview) | `withChatPreview`, `MEDIA_CHAT_PREVIEW_MAX_EDGE_PX` |
| `content-type-store` | a persistent adapter for `MediaContentTypeStorePort` (`getMany` / `set`) | the port, `InMemoryMediaContentTypeStore` (test double) |
| `content-type-resolution` | `ContentTypeDeps`: `workspaceId`, `mediaContentTypeStore`, `assetBlobRepo`, `blobStore` | `resolveContentTypes`, `readRecordedContentType` |
| `hydrate-blob-store-from-seed` | `seedUploadsDir` (a path) and `blobStore: Pick<BlobStorePort, "putIfAbsent">` | `hydrateBlobStoreFromSeed` and its result types |
| `original-bytes` | `deps` (`workspaceId`, `assetBlobRepo`, `blobStore`) and `errorPrefix` (the calling tool's name) | `readStoredBytes` |
| `public-path` | nothing, pure | `mediaUrlKey`, `mediaPublicPath` |
| `upload-content-type` | nothing, pure | `resolveUploadContentType`, `assertAllowedSniffedContentType` |

What the host can rely on:

- `ensureCoreMediaTransform` is find-or-create for `public`, `og` and `thumb`, so call it once per boot;
  without those rows every public rendition lookup misses.
- `resolveContentTypes` sniffs and records any blob with no stored type; an unreadable blob is
  skipped (its type stays unrecorded), never a failed list. `readRecordedContentType` never reads bytes.
- `hydrateBlobStoreFromSeed` writes per key with `putIfAbsent`, so it is safe on every boot. A bad
  seed file lands in `failed`; only an unreadable seed directory throws. It reads the seed with
  `node:fs`, so it is node-only.
- `withChatPreview` is best effort and returns `result` unchanged on any failure.
- Refusals are typed errors (`ToolInputError`, `MediaValidationError`); the host maps them to its wire format.

```ts
import { ensureCoreMediaTransform } from "@jini-ai/cms/media/site/bootstrap";
import { hydrateBlobStoreFromSeed } from "@jini-ai/cms/media/site/hydrate-blob-store-from-seed";
import { resolveContentTypes } from "@jini-ai/cms/media/site/content-type-resolution";
import { mediaPublicPath, mediaUrlKey } from "@jini-ai/cms/media/site/public-path";

await ensureCoreMediaTransform({ deps: { clock, idGen, transformRepo }, input: { workspaceId } }); // once per boot
void hydrateBlobStoreFromSeed({ seedUploadsDir, blobStore }).catch(hostLog); // boot effect, never gates a request
const types = await resolveContentTypes({ deps: { workspaceId, mediaContentTypeStore, assetBlobRepo, blobStore }, media: records });
const href = mediaPublicPath({ key: mediaUrlKey(record), variant: { kind: "transform", name: "public", version: 1, ext: "webp" } });
```

These modules must never import host code (routes, composition roots, product tool catalogs),
an HTTP framework, or a host logger; host collaborators arrive through the deps object. Product
names stay out too. Only `hydrate-blob-store-from-seed` touches the filesystem, and only through
`node:fs` / `node:path`.

### `where-used` / `purge-media`

`findMediaWhereUsed({ deps, input }, { includeTrashed? })` reports every place a media asset is
referenced, by canonical id, current slug and retired slugs: indexed `entry_refs` rows plus a fresh
scan of the host's current post bodies (ordinary post saves do not maintain `entry_refs`).
`purgeMedia({ deps, input })` wraps the shared `purgeMedia` from `@jini-ai/cms/media` with that
lookup as its `referenceCheck`, so a still-referenced asset is refused immediately before deletion.

The host injects, on `deps`:

- `entryRefsRepo: Pick<EntryRefsRepoPort, "findByTarget">` — the reference index.
- `postRepo: { list({ workspaceId }) }` — its post store, returning `id`, `deletedAt`, `bodyJson`,
  `bodyHtml`, `seoExtJson`, `bodyFormat` per post.
- `mediaRepo` (`listRetiredSlugs` for where-used; the full shared purge deps for purge-media), plus
  the shared purge's `blobRepo`/`renditionRepo`/`blobStore`/`clock`.

```ts
import { purgeMedia } from "@jini-ai/cms/media/site/purge-media";

await purgeMedia({ deps: { ...sharedPurgeDeps, entryRefsRepo, postRepo }, input: { workspaceId, id } });
```

### `analytics` / `contracts`

`captureMediaUploaded({ tracker?, actorId, byteLength, kind, source })` sends one bucketed
`media_uploaded` event (no filenames, hashes or bytes) through the host's injected `Tracker`; a
missing or throwing tracker never fails the upload. `contracts` holds the type-only seams the host
composition binds: `RemoveMediaFn` (the host's removal owner, structurally typed so this package
imports nothing from a trash feature) and `MediaPublicUrlDeps` (optional `tracker`,
`mediaContentTypeStore` narrowed to `getMany`/`set`, and `transformDefinitionRepo`).
