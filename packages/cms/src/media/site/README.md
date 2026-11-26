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
- `blobFence: BlobFence`, `storageKeyFor: BlobStorageKeyFor` — the host's shared durable
  byte-key fence and canonical key rule, from `@jini-ai/core/contracts/blob-gc`.
- `verifyStoredBlob({ storageKey, sha256, byteLength }, {})` — reads the stored object and
  rejects a length or digest mismatch, including an active dedup hit or `written: false`.
  A size-only check cannot approve bytes; bounded `get` bindings compare length and hash
  the returned bytes once. Verification must neither overwrite nor delete a corrupt object.
- `clock: { nowIso(): string }`, `idGen: { newId(): string }` — only for a new blob row's id.
- `sha256: { isValidSha256Hex, bytesMatchSha256 }` — the staged-bytes digest rule the host's publish transfer uses.
- `outwardErrorMessage: OutwardErrorMessage` (required) — words a classified media error (write-once
  source, validation, slug conflict) for a `blocked` result's `reason`. This module keeps the
  classification (`status`, `code`); the host decides what the caller may read (pass the message
  through, redact or translate it).

It provides `ImportMediaEntityResult` (`imported` | `blocked` | `conflict`); every refusal is a
typed result, and only unexpected storage failures throw.

```ts
import { importMediaEntity } from "@jini-ai/cms/media/site/import-media-entity";

const result = await importMediaEntity({
  deps: { mediaRepo, assetBlobRepo, blobStore, blobFence, storageKeyFor, verifyStoredBlob,
    clock, idGen, sha256, outwardErrorMessage: ({ error }) => error.message },
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
| `hydrate-blob-store-from-seed` | `seedUploadsDir`, `blobStore: Pick<BlobStorePort, "putIfAbsent">`, `blobFence`, `storageKeyFor`, `verifyStoredBlob` | `hydrateBlobStoreFromSeed` and its result types |
| `original-bytes` | `deps` (`workspaceId`, `assetBlobRepo`, `blobStore`) and `errorPrefix` (the calling tool's name) | `readStoredBytes` |
| `public-path` | nothing, pure | `mediaUrlKey`, `mediaPublicPath` |
| `upload-content-type` | nothing, pure | `resolveUploadContentType`, `assertAllowedSniffedContentType` |

What the host can rely on:

- `ensureCoreMediaTransform` is find-or-create for `public`, `og` and `thumb`, so call it once per boot;
  without those rows every public rendition lookup misses.
- `resolveContentTypes` sniffs and records any blob with no stored type; an unreadable blob is
  skipped (its type stays unrecorded), never a failed list. `readRecordedContentType` never reads bytes.
- `hydrateBlobStoreFromSeed` writes per key with `putIfAbsent`, so it is safe on every boot. A bad
  seed file or corrupt occupied object lands in `failed`; only an unreadable seed directory
  throws. It validates the seed's canonical path and input digest, then holds the byte fence
  through create-only staging and stored-object verification. It reads the seed with `node:fs`,
  so it is node-only. Hydration creates no media ownership rows.
- `withChatPreview` is best effort and returns `result` unchanged on any failure.
- Refusals are typed errors (`ToolInputError`, `MediaValidationError`); the host maps them to its wire format.

```ts
import { ensureCoreMediaTransform } from "@jini-ai/cms/media/site/bootstrap";
import { hydrateBlobStoreFromSeed } from "@jini-ai/cms/media/site/hydrate-blob-store-from-seed";
import { resolveContentTypes } from "@jini-ai/cms/media/site/content-type-resolution";
import { mediaPublicPath, mediaUrlKey } from "@jini-ai/cms/media/site/public-path";

await ensureCoreMediaTransform({ deps: { clock, idGen, transformRepo }, input: { workspaceId } }); // once per boot
void hydrateBlobStoreFromSeed({ seedUploadsDir, blobStore, blobFence, storageKeyFor, verifyStoredBlob }).catch(hostLog); // boot effect, never gates a request
const types = await resolveContentTypes({ deps: { workspaceId, mediaContentTypeStore, assetBlobRepo, blobStore }, media: records });
const href = mediaPublicPath({ key: mediaUrlKey(record), variant: { kind: "transform", name: "public", version: 1, ext: "webp" } });
```

These modules must never import host code (routes, composition roots, product tool catalogs),
an HTTP framework, or a host logger; host collaborators arrive through the deps object. Product
names stay out too. Only `hydrate-blob-store-from-seed` touches the filesystem, and only through
`node:fs` / `node:path`.

`importMediaEntity` keeps the byte fence until its conditional media write finishes, verifies
existing blob rows, and resurrects tombstones without changing blob attribution. `blobWritten`
still reports creation of the blob row, independently of create-only staging's `written` flag.
The publish-content blob PUT leaf requires the same three ports, verifies before returning
`{ sha256, written }`, and creates no active `asset_blobs` row for staging.

Bind every writer and purge to the same fence. Lock order is process-local single-flight lock
→ `withAsset` → `withKeys` (sorted, deduplicated keys) → storage transaction; never acquire an
asset fence from inside a byte fence. This import/staging slice does not replace the separate
replacement/restore or purge/collector work. Consume it together with the host bindings.

#### Journal provenance and writer eligibility (J1a/J1c)

Types live in `@jini-ai/core/contracts/blob-gc` (`BlobJournalIdentity`, `BlobJournalEligibility`);
the pure rules in `@jini-ai/cms/media` (`planRenditionJournal`, `classifyJournalEntry`).

- A rendition row records its own byte digest (`AssetRenditionRecord.sha256`); the original
  passthrough records the source digest. A purge/rollback `cleanupJournal` receives `renditions`
  (derived keys only, own digest, deduplicated against the original's key) and
  `unverifiedRenditionKeys` (no or conflicting digest: report, never journal eligible).
- `reason` is journaled only when the caller states it (`purgeMedia` input `reason`); rollback
  always says `upload-rollback`. Never default a missing reason to `owner-purge`.
- `classifyJournalEntry` is keep-by-default: no reason, unknown reason/role, bad digest, a key that
  is not `storageKeyFor(digest)`, `upload-rollback`, and `trash-ttl` (unless `allowTrashTtl`) are
  all keep. A candidate is not authority to unlink: re-read entry and ownership inside `withKeys`.
- Every writer that takes ownership of a key (upload claim, dedup hit, resurrection, rendition
  save, import, replacement) calls `journalEligibility.clearForKeys` after its owner row is active,
  in the same fence/transaction. The port is optional until the host binds it (T1); nothing here
  enables a sweep.

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

## Wiring (host-injected collaborators)

- `public-urls.ts` — `resolveMediaPublicUrls({ assets, workspaceId, contentTypeStore, transformRepo })`: batched `/m/...` URL selection (original-byte SVG/video/audio, else the latest public transform); the host binds both lookup ports (nullable when unwired).
- `document-archive.ts` — `createDocumentArchiveReader({ yauzl, createArchiveReader })`. cms (L4) may not
  import `@jini-ai/agent-plugins` (L4), so the host injects the promise-style `yauzl` SDK and the streaming
  archive reader factory (agent-plugins' `createYauzlAgentPluginArchiveReader`). The host binds both at each call site.
