Spec ID: SPEC-JINI-CMS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:51b43d23867b764e39970b6e6ba4ec655d38acaf34ba21651e92fef558dfb471
spec_mode: reverse_spec


# CMS API contract

## Export map, runtime and convention

The root `@jini-ai/cms` and `@jini-ai/cms/core` resolve to the same `src/core/index.ts` surface. Every other declared subpath is listed below. Root imports do not aggregate the domain subpaths. `./media` and `./http/settings` are Node-bound; the other implemented subpaths are framework-free. Forms belongs to the separate `@jini-ai/cms-forms` package, with its own contract. Identity tool catalogs/registrations and their dependencies belong to `@jini-ai/user-management/server`.

The intended convention is `(required, optional = {})`. Signatures below describe current source, including one-object and positional legacy exceptions; they do not promise future arguments. A function lacking a second parameter must be called as shown. Error constructors are detailed in `errors.spec.md`; public reference adapter constructors are included here. Empty optional objects are reserved, not configuration.

`UUID`, `ISODateTime`, recursive JSON types, `Clock` and `IdGenerator` are imported from `@jini-ai/core/primitives`; Clock.nowMs() and IdGenerator.newId() are zero-argument. `DomainEvent<T>` carries event identity/name/time/aggregate/workspace and optional actor/change-set metadata plus payload. `Result<T,E>` on the content-type/entry surfaces is `{ok:true,value:T} | {ok:false,error:E}`. These contracts have not been rewritten as future core-package types.

## Host dependency map

| Entry | Consumer-supplied ports and policy |
| --- | --- |
| `.` / `./core` | Commands: clock, ID generator, change-set store; optional outbox wiring; permission and authorize supplied together. Mutations supply inverse capture/execute and optional rollback/version capture. Tool registration supplies catalog, handlers and independent derived-risk map; confirmation supplies prepare/askHuman/run closures. |
| `./core/tools` | Same tool-registration contracts with two-object wrappers; authorization is `AuthorizationPort(required, optional)` rather than the legacy single-object `AuthorizeFn`. `adaptLegacyAuthorize` bridges them. |
| `./navigation` | Menu repository; clock/IDs/outbox for writes; binding repository for locations/delete/read model; target-href resolver for non-URL resolution; optional tree limits. No authorization port on domain writers. |
| `./media` | Upload: clock/IDs/media/blob/rendition repositories and blob store; optional MIME/size policy. Metadata/trash: media repo + clock. Purge/rollback: row stores + optional clock. GC: media/blob/journal stores, clock/IDs as required; unlink also needs blob store. Transform registry: clock/IDs/transform repo. Rendition: all row stores, blob store, transformer, clock/IDs. |
| `./media/import` | HTTP client, outbound execution guard, byte ceiling, MIME allowlist and content sniffer; optional timeout. No repositories or persistence. |
| `./settings` | Reads: `SettingsRepoPort`. Writes: repo, clock, `ids`, legacy authorize and `PrincipalRepoPort` from identity; purge omits IDs/principals. Definition seeding uses those write ports. Coercers and change-feed namespace lookup are caller closures. Scope/workspace/caller IDs must be explicit. |
| `./workspace` | Create: workspace repo, clock/IDs/outbox. Update/delete: workspace repo. Tool registration additionally supplies authorize/workspace context. |
| `./entries` | Entry repo, read-only owning-type lookup, clock, authorization, narrow event outbox; creation additionally needs IDs. Optional watermark and same-transaction `onWritten` callback; argument records below identify each operation's input. |
| `./content-types` | Type repo, clock/IDs, authorization, index provisioner, narrow outbox and optional watermark. Lifecycle needs repo/clock/auth, with outbox for deprecate/tombstone and index teardown for tombstone. Cleanup uses separate plan/execute gateway ports and a host-tenant-bound cleanup repo. |
| `./taxonomy` | `WriteServiceDeps`: authorize, clock/IDs, taxonomy/term/assignment/revision repos, awaited watermark callback, `{enqueue({event})}` outbox, caller workspace and content lookup; optional content-type taxonomy policy. Delete adds transactional closure + deletion/count capabilities. Merge injects overlap and plan/confirm/execute callbacks. |
| `./presentation` | Settings repo; theme allowlist optional; clock additionally required for theme writes. No renderer or authorization. |

Ports with the same name on different subpaths are not interchangeable by name alone. Entry/content-type outboxes accept `{name,payload}`; core outboxes accept full domain events; taxonomy accepts `{event}`. `toEntryOutbox`, `toContentTypeOutbox` and `toTaxonomyOutbox` bind a host workspace, clock and IDs to bridge those shapes.

Core `EventBusPort.subscribe({eventName,handler}, {})` and `subscribeAll({handler}, {})` return `Promise<() => Promise<void>>`; `publish(event)` and ordered `publishBatch({events}, {})` return `Promise<void>`. Core outbox methods are `enqueue(event)`, `claimPending({batchSize,nowIso}, {})`, `markDelivered({id}, {})`, `markFailed({id,error,nextAttemptAt,nextStatus}, {})`. The host provides implementations and worker policy. `ChangeSetRepoPort.insert({record,items},{event?})` must co-persist its optional event; reads are scoped by workspace. No bus, outbox or change-set repository implementation is exported.

## Public signatures by entry

Signature blocks use documentation notation, including default initializers; they are not complete compilable ambient declarations. Each block records callable signatures, exported data/type names and links to the defining source. Named required records are expanded below where they are exported; other named types are the contracts exported by the linked source/barrel, not inferred provider DTOs. Catalogs/risk maps/dispatch maps are data exports; importing them does not register tools or execute operations.

### `.` and `./core`

Source: [ports.ts](../../src/core/ports.ts), [change-set.ts](../../src/core/commands/change-set.ts), [command.ts](../../src/core/commands/command.ts), [entity-liveness.ts](../../src/core/entity-liveness.ts), [authorization.ts](../../src/core/authorization.ts).

```ts
declare function executeCommand<TResult>( required: ExecuteCommandRequired<TResult>, _optional: ExecuteCommandOptional = {} ): Promise<{ result: TResult; changeSetId: UUID }>;
declare function assertEntityLive(required: { entityType: string; entityId: string; state: EntityLiveness }): void;
declare function requireToolPermission( deps: { authorize: AuthorizeFn; workspaceId: string }, required: { principalId: string; permission: string; entityType?: string | undefined; entityId?: string | undefined }, ): Promise<void>;
```

Types/data: `DomainEvent`, `EventBusPort`, `OutboxRecord`, `OutboxPort`, `ChangeSetStatus`, `ChangeSetOperation`, `ChangeSetRecord`, `ChangeSetItemRecord`, `ChangeSetWithItems`, `ChangeSetRepoPort`, `CommandActor`, `CommandEnvelope`, `CommandMutation`, `AuthorizeFn`, `ExecuteCommandDeps`, `ExecuteCommandRequired`, `ExecuteCommandOptional`, `EntityLiveness`, `AgentToolSideEffect`, `AgentToolActorClassRule`, `AuthorizationRequired`, `AuthorizationOptional`, `AuthorizationPort`.

```ts
interface ExecuteCommandDeps { clock: Clock; idGen: IdGenerator; changeSets: ChangeSetRepoPort; outbox?: OutboxPort | undefined; authorize?: AuthorizeFn | undefined; }
interface ExecuteCommandRequired<TResult> { deps: ExecuteCommandDeps; command: CommandEnvelope; mutation: CommandMutation<TResult>; }
interface ExecuteCommandOptional {}
interface AuthorizationRequired { principalId: string; permission: string; workspaceId: string; }
interface AuthorizationOptional { entityType?: string | undefined; entityId?: string | undefined; }
```

Wiring (adapters/context are host-provided):

```ts
import { executeCommand } from "@jini-ai/cms/core";
const applied = await executeCommand({
  deps: { clock, idGen, changeSets, authorize },
  command: { workspaceId, actor, permission, summary: "Update content", idempotencyKey },
  mutation: { entityType, entityId, operation: "update", captureInverse, execute, rollback },
}, {}); // { result, changeSetId }
```

### `./navigation`

Source: [types.ts](../../src/navigation/types.ts), [ports.ts](../../src/navigation/ports.ts), [contracts.ts](../../src/navigation/contracts.ts), [read-model.ts](../../src/navigation/read-model.ts), [repo.memory.ts](../../src/navigation/repo.memory.ts), [menu-service.ts](../../src/navigation/menu-service.ts), [resolver.ts](../../src/navigation/resolver.ts), [reconcile.ts](../../src/navigation/reconcile.ts), [agent-tools.ts](../../src/navigation/agent-tools.ts), [tool-registrations.ts](../../src/navigation/tool-registrations.ts).

```ts
declare function createNavMenuReadModel(deps: NavMenuReadModelDeps, optional: NavMenuReadModelOptions = {}): NavMenuReadModel;
declare function isAllowedHref({ rawHref }: { rawHref: string }, _optional: Record<string, never> = {}): boolean;
declare function validateAndCloneTree( { items }: { items: readonly NavItemNode[] }, limits: TreeValidationLimits = {} ): NavItemNode[];
declare function createMenu( required: CreateMenuRequired, optional: CreateMenuOptional = {} ): Promise<{ menu: NavMenuEntry }>;
declare function updateMenuTree( required: UpdateMenuTreeRequired, optional: UpdateMenuTreeOptional = {} ): Promise<{ menu: NavMenuEntry }>;
declare function assignLocation( required: AssignLocationRequired, _optional: AssignLocationOptional = {} ): Promise<{ menu: NavMenuEntry; binding: NavLocationBindingRow; displacedMenu: NavMenuEntry | null }>;
declare function deleteMenu( required: DeleteMenuRequired, _optional: DeleteMenuOptional = {} ): Promise<{ menu: NavMenuEntry | null; purged: boolean }>;
declare function resolveForLocation( required: ResolveForLocationRequired, _optional: ResolveForLocationOptional = {} ): Promise<ResolvedNav | null>;
declare function resolveMenuDoc(required: ResolveMenuDocRequired): Promise<ResolvedNavItem[]>;
declare function rebuildNavLocationBindings( deps: RebuildNavLocationBindingsDeps ): Promise<RebuildNavLocationBindingsResult>;
declare function buildMenusRegistrations(routeDeps: MenusToolDeps): ToolRegistration[];
```

Types/data: `NavTargetKind`, `ReservedNavTargetKind`, `NavEntryTarget`, `NavTermTarget`, `NavUrlTarget`, `NavRouteTarget`, `NavTarget`, `NavItemAttrs`, `NavItemNode`, `NavMenuDoc`, `MenuStatus`, `NavMenuEntry`, `NavLocationKey`, `NavLocationBindingRow`, `NavLocationDescriptor`, `ResolvedNavItem`, `ResolvedNav`, `NAV_MENU_CONTENT_TYPE`, `NAV_FIELD_NAMESPACE`, `NAV_DOC_TYPE`, `NavLocationBindingRepoPort`, `NavResolveContext`, `NavTargetResolver`, `NavMenuReadModel`, `NavLocationRegistry`, `NavigationPermission`, `CreateMenuInput`, `UpdateMenuInput`, `AssignLocationInput`, `UnassignLocationInput`, `DeleteMenuInput`, `NavigationEventName`, `NavMenuChangedPayload`, `NavLocationChangedPayload`, `NavigationHookName`, `NavigationAiTool`, `NavWhereUsedResult`, `NAVIGATION_PERMISSIONS`, `NAVIGATION_EVENTS`, `NAVIGATION_HOOKS`, `NAVIGATION_AI_TOOLS`, `NavMenuReadModelDeps`, `NavMenuReadModelOptions`, `MenuRepoPort`, `DEFAULT_MAX_TREE_DEPTH`, `DEFAULT_MAX_ITEM_COUNT`, `ALLOWED_HREF_SHAPES_DESCRIPTION`, `TreeValidationLimits`, `CreateMenuDeps`, `CreateMenuServiceInput`, `CreateMenuRequired`, `CreateMenuOptional`, `UpdateMenuTreeDeps`, `UpdateMenuTreeServiceInput`, `UpdateMenuTreeRequired`, `UpdateMenuTreeOptional`, `AssignLocationDeps`, `AssignLocationServiceInput`, `AssignLocationRequired`, `AssignLocationOptional`, `DeleteMenuDeps`, `DeleteMenuServiceInput`, `DeleteMenuRequired`, `DeleteMenuOptional`, `ResolvedTargetHref`, `ResolveTargetHrefFn`, `ResolveForLocationDeps`, `ResolveForLocationServiceInput`, `ResolveForLocationRequired`, `ResolveForLocationOptional`, `RebuildNavLocationBindingsDeps`, `RebuildNavLocationBindingsResult`, `NavigationAgentToolSideEffect`, `NavigationAgentToolActorClassRule`, `NavigationAgentToolDefinition`, `menusAgentToolCatalog`, `MenusToolDeps`, `menusDerivedRisk`.

```ts
interface CreateMenuInput { readonly workspaceId: UUID; readonly title: string; readonly slug: string; readonly items?: readonly NavItemNode[] | undefined; }
interface UpdateMenuInput { readonly workspaceId: UUID; readonly id: UUID; readonly title: string; readonly slug: string; readonly items: readonly NavItemNode[]; }
interface AssignLocationInput { readonly workspaceId: UUID; readonly menuId: UUID; readonly locationKey: NavLocationKey; }
interface UnassignLocationInput { readonly workspaceId: UUID; readonly locationKey: NavLocationKey; }
interface DeleteMenuInput { readonly workspaceId: UUID; readonly id: UUID; readonly force?: boolean | undefined; }
interface NavMenuReadModelDeps { menuRepo: MenuRepoPort; bindingRepo: NavLocationBindingRepoPort; }
interface CreateMenuDeps { repo: MenuRepoPort; clock: Clock; idGen: IdGenerator; outbox: OutboxPort; }
interface CreateMenuServiceInput { workspaceId: UUID; title: string; slug: string; items?: readonly NavItemNode[] | undefined; }
interface CreateMenuRequired { deps: CreateMenuDeps; input: CreateMenuServiceInput; }
interface CreateMenuOptional { limits?: TreeValidationLimits | undefined; }
interface UpdateMenuTreeDeps { repo: MenuRepoPort; clock: Clock; idGen: IdGenerator; outbox: OutboxPort; }
interface UpdateMenuTreeServiceInput { workspaceId: UUID; id: UUID; expectedVersion: number; title?: string | undefined; slug?: string | undefined; items: readonly NavItemNode[]; }
interface UpdateMenuTreeRequired { deps: UpdateMenuTreeDeps; input: UpdateMenuTreeServiceInput; }
interface UpdateMenuTreeOptional { limits?: TreeValidationLimits | undefined; }
interface AssignLocationDeps { repo: MenuRepoPort; bindingRepo: NavLocationBindingRepoPort; clock: Clock; idGen: IdGenerator; outbox: OutboxPort; }
interface AssignLocationServiceInput { workspaceId: UUID; menuId: UUID; locationKey: NavLocationKey; }
interface AssignLocationRequired { deps: AssignLocationDeps; input: AssignLocationServiceInput; }
interface AssignLocationOptional {}
interface DeleteMenuDeps { repo: MenuRepoPort; bindingRepo: NavLocationBindingRepoPort; clock: Clock; idGen: IdGenerator; outbox: OutboxPort; }
interface DeleteMenuServiceInput { workspaceId: UUID; id: UUID; force?: boolean | undefined; }
interface DeleteMenuRequired { deps: DeleteMenuDeps; input: DeleteMenuServiceInput; }
interface DeleteMenuOptional {}
interface ResolveForLocationDeps { menuRepo: MenuRepoPort; bindingRepo: NavLocationBindingRepoPort; resolveTargetHref: ResolveTargetHrefFn; }
interface ResolveForLocationServiceInput { workspaceId: string; locationKey: NavLocationKey; currentPath?: string | undefined; }
interface ResolveForLocationRequired { deps: ResolveForLocationDeps; input: ResolveForLocationServiceInput; }
interface ResolveForLocationOptional {}
interface RebuildNavLocationBindingsDeps { menuRepo: MenuRepoPort; bindingRepo: NavLocationBindingRepoPort; clock: Clock; workspaceId: UUID; }
interface MenusToolDeps { authorize: AuthorizeFn; workspaceId: string; clock: Clock; idGen: { newId(): string }; outbox: OutboxPort; menuRepo: MenuRepoPort; navLocationBindingRepo: NavLocationBindingRepoPort; }
```

- `new InMemoryMenuRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: NavMenuEntry[] } = {})` → `InMemoryMenuRepo`; methods implement `MenuRepoPort`.
- `new InMemoryNavLocationBindingRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: NavLocationBindingRow[] } = {})` → `InMemoryNavLocationBindingRepo`; methods implement `NavLocationBindingRepoPort`.

Wiring (adapters/context are host-provided):

```ts
import { createNavMenuReadModel, createMenu } from "@jini-ai/cms/navigation";
const readModel = createNavMenuReadModel({ menuRepo, bindingRepo }, { resolveTargetHref });
const created = await createMenu({ deps: { repo: menuRepo, clock, idGen, outbox },
  input: { workspaceId, title: "Primary", slug: "primary", items: [] } }, {});
```

### `./media`

Source: [types.ts](../../src/media/types.ts), [ports.ts](../../src/media/ports.ts), [blob-key.ts](../../src/media/blob-key.ts), [html-attributes.ts](../../src/media/html-attributes.ts), [repo.memory.ts](../../src/media/repo.memory.ts), [blob-gc-lock.ts](../../src/media/blob-gc-lock.ts), [blob-gc.ts](../../src/media/blob-gc.ts), [blob-store.memory.ts](../../src/media/blob-store.memory.ts), [blob-store.fs.ts](../../src/media/blob-store.fs.ts), [media-service.ts](../../src/media/media-service.ts), [transform-types.ts](../../src/media/transform-types.ts), [transform-lock.ts](../../src/media/transform-lock.ts), [transform-registry.ts](../../src/media/transform-registry.ts), [rendition-service.ts](../../src/media/rendition-service.ts), [image-transformer.ts](../../src/media/image-transformer.ts), [image-transformer.sharp.ts](../../src/media/image-transformer.sharp.ts), [content-type-sniffer.ts](../../src/media/content-type-sniffer.ts), [agent-tools.ts](../../src/media/agent-tools.ts), [tool-registrations.ts](../../src/media/tool-registrations.ts).

```ts
declare function computeBlobStorageKey(input: { workspaceId: UUID; sha256: string }): string;
declare function isAllowedMediaHtmlAttributeName(requiredArgs: { name: string }, optionalArgs: Record<string, never> = {}): boolean;
declare function parseMediaHtmlAttributes(requiredArgs: { text: string }, optionalArgs: Record<string, never> = {}): ParsedMediaHtmlAttributes;
declare function describeMediaHtmlAttributeError(error: MediaHtmlAttributeError): string;
declare function withSha256Lock<T>(requiredArgs: { key: string; criticalSection: () => Promise<T> }, optionalArgs: Record<string, never> = {}): Promise<T>;
declare function resolveGcGraceMs(input: { workspaceId: UUID; sha256: string }): number;
declare function isBlobUnreferenced(required: IsBlobUnreferencedRequired): Promise<boolean>;
declare function tombstoneBlobIfUnreferenced( required: TombstoneBlobRequired ): Promise<{ tombstoned: boolean; reason: string }>;
declare function runBlobGcDeletePass( required: RunBlobGcDeletePassRequired ): Promise<{ deleted: boolean; reason: string }>;
declare function runBlobGcUnlinkPass( required: RunBlobGcUnlinkPassRequired ): Promise<{ unlinked: string[]; skipped: string[] }>;
declare function runBlobGcCycle( required: RunBlobGcCycleRequired ): Promise<{ deletedShas: string[]; unlinked: string[]; skipped: string[] }>;
declare function runMonthlyOrphanSweepStub( _required: { deps: { blobStore: BlobStorePort; blobRepo: AssetBlobRepoPort }; input: { workspaceId: UUID } }, _optional: Record<string, never> = {} ): Promise<{ implemented: false }>;
declare function resolveWriteOnceSource( required: { existing: MediaSource | undefined; requestedSha256: string }, _optional: Record<string, never> = {} ): MediaSource;
declare function isValidMediaSlugFormat(requiredArgs: { slug: string }, optionalArgs: Record<string, never> = {}): boolean;
declare function uploadMedia( required: UploadMediaRequired, optional: UploadMediaOptional = {} ): Promise<{ media: MediaRecord }>;
declare function listMedia( required: ListMediaRequired, _optional: Record<string, never> = {} ): Promise<{ media: MediaRecord[] }>;
declare function getMediaById( required: GetMediaByIdRequired, _optional: Record<string, never> = {} ): Promise<{ media: MediaRecord }>;
declare function findMediaByIdOrSlug( required: FindMediaByIdOrSlugRequired, _optional: Record<string, never> = {} ): Promise<MediaRecord | null>;
declare function updateMediaMetadata( required: UpdateMediaMetadataRequired, _optional: Record<string, never> = {} ): Promise<{ media: MediaRecord }>;
declare function trashMedia( required: TrashMediaRequired, _optional: Record<string, never> = {} ): Promise<{ media: MediaRecord }>;
declare function purgeMedia( required: PurgeMediaRequired, _optional: Record<string, never> = {} ): Promise<{ purged: true }>;
declare function mimeForTransformFormat(requiredArgs: { format: TransformFormat }, optionalArgs: Record<string, never> = {}): string;
declare function registerTransform( required: RegisterTransformRequired, _optional: Record<string, never> = {} ): Promise<{ definition: TransformDefinitionRecord }>;
declare function getLatestTransformDefinition( required: GetLatestTransformDefinitionRequired ): Promise<TransformDefinitionRecord | null>;
declare function isLatestTransformVersion(required: IsLatestTransformVersionRequired): Promise<boolean>;
declare function isReferencedByPublishedContent(_input: { workspaceId: UUID; name: string; version: number; }): boolean;
declare function resolveMediaRendition( required: ResolveMediaRenditionRequired, _optional: Record<string, never> = {} ): Promise<ResolveMediaRenditionResult>;
declare function sniffContentType({ bytes }: { bytes: Uint8Array }, _optional: Record<string, never> = {}): SniffedContentType;
declare function buildMediaRegistrations(required: Omit<MediaToolDeps, "resolvePublicUrls" | "recordUploadContentType" | "maxUploadBytes">, optional: Pick<MediaToolDeps, "resolvePublicUrls" | "recordUploadContentType" | "maxUploadBytes"> = {}): ToolRegistration[];
declare function rollbackUploadedMedia( required: RollbackUploadedMediaRequired, _optional: Record<string, never> = {} ): Promise<void>;
```

Types/data: `MediaStatus`, `MediaSource`, `MediaRecord`, `AssetBlobStatus`, `AssetBlobRecord`, `BlobGcJournalEntry`, `AssetRenditionRecord`, `MediaRepoPort`, `AssetBlobRepoPort`, `BlobGcJournalRepoPort`, `AssetRenditionRepoPort`, `TransformDefinitionRepoPort`, `PutBlobInput`, `BlobStorePort`, `MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES`, `MediaHtmlAttributeRejectionReason`, `MediaHtmlAttributeError`, `ParsedMediaHtmlAttributes`, `DEFAULT_GC_GRACE_MS`, `LocalFsBlobStoreDeps`, `DEFAULT_MAX_UPLOAD_BYTES`, `DEFAULT_ALLOWED_MIME_TYPES`, `UploadMediaInput`, `UploadMediaDeps`, `FindMediaByIdOrSlugRequired`, `UpdateMediaMetadataInput`, `TransformFit`, `TransformFormat`, `TransformParams`, `TransformDefinitionRecord`, `MAX_TRANSFORM_DIMENSION_PX`, `withTransformRegistryLock`, `withRenditionLock`, `RegisterTransformInput`, `RegisterTransformDeps`, `ResolveMediaRenditionDeps`, `ResolveMediaRenditionInput`, `ResolveMediaRenditionResult`, `TransformImageInput`, `TransformImageOutput`, `ImageTransformerPort`, `SniffedContentType`, `MediaAgentToolSideEffect`, `MediaAgentToolActorClassRule`, `MediaAgentToolDefinition`, `mediaAgentToolCatalog`, `MediaToolDeps`, `mediaDerivedRisk`, `UploadMediaRequired`, `UploadMediaOptional`, `ListMediaRequired`, `GetMediaByIdRequired`, `UpdateMediaMetadataRequired`, `TrashMediaRequired`, `PurgeMediaRequired`, `RollbackUploadedMediaRequired`, `ResolveMediaRenditionRequired`, `RegisterTransformRequired`, `GetLatestTransformDefinitionRequired`, `IsLatestTransformVersionRequired`, `IsBlobUnreferencedRequired`, `TombstoneBlobRequired`, `RunBlobGcDeletePassRequired`, `RunBlobGcUnlinkPassRequired`, `RunBlobGcCycleRequired`, `MediaRowCleanupDeps`.

```ts
interface PutBlobInput { workspaceId: UUID; sha256: string; bytes: Uint8Array; }
interface LocalFsBlobStoreDeps { rootDir: string; }
interface UploadMediaInput { workspaceId: UUID; bytes: Uint8Array; filename: string; contentType: string; alt?: string | undefined; caption?: string | undefined; credit?: string | undefined; createdByPrincipal: string; }
interface UploadMediaDeps { clock: Clock; idGen: IdGenerator; mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; renditionRepo: AssetRenditionRepoPort; blobStore: BlobStorePort; }
interface FindMediaByIdOrSlugRequired { deps: { mediaRepo: MediaRepoPort }; input: { workspaceId: UUID; idOrSlug: string }; }
interface UpdateMediaMetadataInput { workspaceId: UUID; id: UUID; title?: string | undefined; alt?: string | undefined; caption?: string | undefined; credit?: string | undefined; width?: number | null | undefined; height?: number | null | undefined; cssClass?: string | null | undefined; slug?: string | undefined; htmlAttributes?: string | null | undefined; }
interface RegisterTransformInput { workspaceId: UUID; name: string; params: TransformParams; owner: string; }
interface RegisterTransformDeps { clock: Clock; idGen: IdGenerator; transformRepo: TransformDefinitionRepoPort; }
interface ResolveMediaRenditionDeps { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; renditionRepo: AssetRenditionRepoPort; transformRepo: TransformDefinitionRepoPort; blobStore: BlobStorePort; imageTransformer: ImageTransformerPort; clock: Clock; idGen: IdGenerator; }
interface ResolveMediaRenditionInput { workspaceId: UUID; assetId: string; transformName: string; version: number; }
interface TransformImageInput { bytes: Uint8Array; params: TransformParams; }
interface MediaToolDeps { authorize: AuthorizeFn; workspaceId: string; clock: Clock; idGen: { newId(): string }; mediaRepo: MediaRepoPort; assetBlobRepo: AssetBlobRepoPort; assetRenditionRepo: AssetRenditionRepoPort; blobStore: BlobStorePort; resolvePublicUrls?: ((required: { assets: readonly MediaRecord[] }, optional?: Record<string, never>) => Promise<ReadonlyMap<string, string | null>>) | undefined; recordUploadContentType?: ((params: { media: MediaRecord; bytes: Uint8Array }) => Promise<void>) | undefined; maxUploadBytes?: number | undefined; }
interface UploadMediaRequired { deps: UploadMediaDeps; input: UploadMediaInput; }
interface UploadMediaOptional { maxUploadBytes?: number | undefined; allowedMimeTypes?: ReadonlySet<string> | undefined; }
interface ListMediaRequired { deps: { mediaRepo: MediaRepoPort }; input: { workspaceId: UUID }; }
interface GetMediaByIdRequired { deps: { mediaRepo: MediaRepoPort }; input: { workspaceId: UUID; id: UUID }; }
interface UpdateMediaMetadataRequired { deps: UpdateMediaMetadataDeps; input: UpdateMediaMetadataInput; }
interface TrashMediaRequired { deps: TrashMediaDeps; input: { workspaceId: UUID; id: UUID }; }
interface PurgeMediaRequired { deps: PurgeMediaDeps; input: { workspaceId: UUID; id: UUID }; }
interface RollbackUploadedMediaRequired { deps: MediaRowCleanupDeps; input: { workspaceId: UUID; media: MediaRecord }; }
interface ResolveMediaRenditionRequired { deps: ResolveMediaRenditionDeps; input: ResolveMediaRenditionInput; }
interface RegisterTransformRequired { deps: RegisterTransformDeps; input: RegisterTransformInput; }
interface GetLatestTransformDefinitionRequired { deps: { transformRepo: TransformDefinitionRepoPort }; input: { workspaceId: UUID; name: string }; }
interface IsLatestTransformVersionRequired { deps: { transformRepo: TransformDefinitionRepoPort }; input: { workspaceId: UUID; name: string; version: number }; }
interface IsBlobUnreferencedRequired { deps: { mediaRepo: MediaRepoPort }; input: { workspaceId: UUID; sha256: string }; }
interface TombstoneBlobRequired { deps: TombstoneBlobDeps; input: { workspaceId: UUID; sha256: string }; }
interface RunBlobGcDeletePassRequired { deps: RunBlobGcDeletePassDeps; input: { workspaceId: UUID; sha256: string }; }
interface RunBlobGcUnlinkPassRequired { deps: RunBlobGcUnlinkPassDeps; input: { workspaceId: UUID }; }
interface RunBlobGcCycleRequired { deps: RunBlobGcCycleDeps; input: { workspaceId: UUID }; }
interface MediaRowCleanupDeps { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; renditionRepo: AssetRenditionRepoPort; clock?: Clock | undefined; }
```

- `new InMemoryMediaRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: MediaRecord[] } = {})` → `InMemoryMediaRepo`; methods implement `MediaRepoPort`.
- `new InMemoryAssetBlobRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: AssetBlobRecord[] } = {})` → `InMemoryAssetBlobRepo`; methods implement `AssetBlobRepoPort`.
- `new InMemoryAssetRenditionRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: AssetRenditionRecord[] } = {})` → `InMemoryAssetRenditionRepo`; methods implement `AssetRenditionRepoPort`.
- `new InMemoryBlobGcJournalRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: BlobGcJournalEntry[] } = {})` → `InMemoryBlobGcJournalRepo`; methods implement `BlobGcJournalRepoPort`.
- `new InMemoryTransformDefinitionRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: TransformDefinitionRecord[] } = {})` → `InMemoryTransformDefinitionRepo`; methods implement `TransformDefinitionRepoPort`.
- `new InMemoryBlobStore()` → `InMemoryBlobStore`; methods implement `BlobStorePort`.
- `new LocalFsBlobStore(deps: LocalFsBlobStoreDeps)` → `LocalFsBlobStore`; methods implement `BlobStorePort`.
- `new InMemoryImageTransformer()` → `InMemoryImageTransformer`; methods implement `ImageTransformerPort`.
- `new SharpImageTransformer()` → `SharpImageTransformer`; methods implement `ImageTransformerPort`.

`withRenditionLock<T>` and `withTransformRegistryLock<T>` have `(required: {key:string; criticalSection:()=>Promise<T>}, optional: Record<string,never> = {}) => Promise<T>`.

Wiring (adapters/context are host-provided):

```ts
import { uploadMedia, LocalFsBlobStore } from "@jini-ai/cms/media";
const blobStore = new LocalFsBlobStore({ rootDir: uploadRoot });
const uploaded = await uploadMedia({
  deps: { clock, idGen, mediaRepo, blobRepo, renditionRepo, blobStore },
  input: { workspaceId, bytes, filename: "image.png", contentType: "image/png", createdByPrincipal },
}, { maxUploadBytes: 10 * 1024 * 1024, allowedMimeTypes });
```

### `./settings`

Source: [types.ts](../../src/settings/types.ts), [ports.ts](../../src/settings/ports.ts), [repo.memory.ts](../../src/settings/repo.memory.ts), [settings.ts](../../src/settings/settings.ts), [write-service.ts](../../src/settings/write-service.ts), [purge-service.ts](../../src/settings/purge-service.ts), [change-feed.ts](../../src/settings/change-feed.ts), [definitions-dispatch.ts](../../src/settings/definitions-dispatch.ts), [ensure-definitions.ts](../../src/settings/ensure-definitions.ts), [ui-tab-definitions.ts](../../src/settings/ui-tab-definitions.ts), [agent-writable-preferences.ts](../../src/settings/agent-writable-preferences.ts), [agent-tools.ts](../../src/settings/agent-tools.ts), [tool-registrations.ts](../../src/settings/tool-registrations.ts), [index.ts](../../src/settings/dictionaries/index.ts), [agent-write-denylist.ts](../../src/settings/agent-write-denylist.ts), [agent-value-write-tools.ts](../../src/settings/agent-value-write-tools.ts).

```ts
declare function validateDefinitionInput( input: DefinitionInput ): { valid: true } | { valid: false; error: DefinitionInvalidError | SecretNotSupportedError };
declare function validateValueAgainstSchema(schema: SettingValueSchema, value: JsonValue): boolean;
declare function registerCoercer({ tag, fn }: { tag: string; fn: (required: { value: JsonValue }) => JsonValue }, _optional: Record<string, never> = {}): void;
declare function invalidateDefinitionNamespaceCache(repo: SettingsRepoPort, namespace: string): void;
declare function invalidateWorkspaceSettingsCache(_required: { repo: SettingsRepoPort; workspaceId: string }, _optional: { principalId?: string | undefined } = {}): void;
declare function resolveDefinitionRaw( deps: { repo: SettingsRepoPort }, input: { namespace: string; key: string; workspaceId: string | null } ): Promise<SettingDefinitionRecord | null>;
declare function resolveDefinition( deps: { repo: SettingsRepoPort }, input: { namespace: string; key: string; workspaceId: string | null } ): Promise<SettingDefinitionRecord | null>;
declare function getEffective( deps: { repo: SettingsRepoPort }, input: { namespace: string; key: string; scopeContext: SettingScopeContext } ): Promise<ResolvedSetting | null>;
declare function deriveRequiredPermission(input: { scope: SettingScope; targetPrincipalId?: UUID | undefined; callerPrincipalId: UUID; }): string;
declare function registerDefinitions( required: RegisterDefinitionsRequired ): Promise<{ registered: string[] }>;
declare function set(required: SetValueRequired): Promise<{ value: JsonValue; revisionSeq: number }>;
declare function clear(required: ClearValueRequired): Promise<{ revisionSeq: number }>;
declare function resetNamespace( required: ResetNamespaceRequired, keysInNamespace: string[] ): Promise<{ clearedCount: number; revisionSeqs: number[] }>;
declare function renameDefinition( required: RenameDefinitionRequired ): Promise<{ settingId: string; markerSettingId: string }>;
declare function retypeDefinition( required: RetypeDefinitionRequired ): Promise<{ settingId: string; version: number }>;
declare function reconcileDefinitionDefault( required: ReconcileDefinitionDefaultRequired ): Promise<{ settingId: string; changed: boolean }>;
declare function deprecateDefinition( required: DeprecateDefinitionRequired ): Promise<{ settingId: string; version: number }>;
declare function tombstoneDefinition( required: TombstoneDefinitionRequired ): Promise<{ settingId: string; version: number }>;
declare function purgeTenantSettings( required: PurgeTenantSettingsRequired ): Promise<{ purgedCount: number }>;
declare function isRevisionVisibleTo({ revision, viewer }: { revision: SettingRevisionRecord; viewer: ChangeFeedViewer }, _optional: Record<string, never> = {}): boolean;
declare function collectChangedNamespaces( { revisions, viewer, resolveNamespace }: { revisions: readonly SettingRevisionRecord[]; viewer: ChangeFeedViewer; resolveNamespace: (required: { settingId: string }) => Promise<string | null>; }, _optional: Record<string, never> = {}, ): Promise<ChangeFeedBatch>;
declare function parseNonRegisterDefinitionOp({ op }: { op: string }, _optional: Record<string, never> = {}): NonRegisterDefinitionOp | null;
declare function ensureSettingDefinitions( deps: EnsureSettingDefinitionsDeps, input: EnsureSettingDefinitionsInput, ): Promise<void>;
declare function ensureSettingsUiTabDefinitions( deps: EnsureSettingDefinitionsDeps, input: EnsureSettingsUiTabDefinitionsInput, ): Promise<void>;
declare function resolveAgentWritablePreference(settingId: string): AgentWritablePreference | undefined;
declare function getSettingsAgentToolCatalog(): AgentToolDefinition[];
declare function buildSettingsRegistrations(routeDeps: SettingsToolDeps): ToolRegistration[];
declare function translateSettingsDialog({ locale, key }: { locale: string; key: string }, _optional: Record<string, never> = {}): string;
declare function findAgentWriteRule(rules: readonly AgentSettingWriteRule[], target: { namespace: string; key: string }): AgentSettingWriteRule | undefined;
```

Types/data: `SettingScope`, `SettingOwnerKind`, `DefinitionStatus`, `ValueState`, `RevisionEntityKind`, `RevisionOp`, `SCOPE_BIT`, `SettingValueSchema`, `SettingDefinitionRecord`, `SettingValueRecord`, `SettingRevisionRecord`, `SettingScopeContext`, `SettingsRepoPort`, `DefinitionInput`, `ResolvedSetting`, `AuthorizeFn`, `SettingsWriteServiceDeps`, `RegisterDefinitionsRequired`, `SetValueRequired`, `ClearValueRequired`, `ResetNamespaceRequired`, `RenameDefinitionRequired`, `RetypeDefinitionRequired`, `ReconcileDefinitionDefaultRequired`, `DeprecateDefinitionRequired`, `TombstoneDefinitionRequired`, `PurgeServiceDeps`, `PurgeTenantSettingsRequired`, `ChangeFeedViewer`, `ChangeFeedBatch`, `DefinitionOpRequestItem`, `DefinitionOpContext`, `DefinitionOpHandler`, `NON_REGISTER_DEFINITION_OP_NAMES`, `NonRegisterDefinitionOp`, `NON_REGISTER_DEFINITION_OPS`, `SettingDefinitionSpec`, `EnsureSettingDefinitionsDeps`, `EnsureSettingDefinitionsInput`, `INSTRUCTIONS_NAMESPACE`, `NOTIFICATIONS_NAMESPACE`, `PRIVACY_NAMESPACE`, `APPEARANCE_NAMESPACE`, `LANGUAGE_NAMESPACE`, `EnsureSettingsUiTabDefinitionsInput`, `AgentWritablePreference`, `AGENT_PREFERENCE_WRITE_SCOPE`, `AGENT_WRITABLE_PREFERENCES`, `AGENT_WRITABLE_PREFERENCE_IDS`, `AGENT_PREFERENCE_REQUIRED_SCOPE_BIT`, `SettingsAgentToolSideEffect`, `SettingsAgentToolDefinition`, `SettingsToolDeps`, `settingsDerivedRisk`, `SETTINGS_DIALOG_DICTIONARIES`, `AgentSettingWriteRule`, `AGENT_WRITE_CONFIRMATION_SETTINGS`, `AGENT_WRITE_DENIED_SETTINGS`, `SettingsValueWriteToolId`, `SettingsWriteConfirmation`.

```ts
interface DefinitionInput { namespace: string; key: string; ownerKind: SettingOwnerKind; workspaceId: string | null; ownerId?: string | null | undefined; schema: SettingValueSchema; defaultValue: JsonValue | null; scopes: number; secret: boolean; }
interface SettingsWriteServiceDeps { repo: SettingsRepoPort; clock: Clock; ids: IdGenerator; authorize: AuthorizeFn; principals: PrincipalRepoPort; }
interface RegisterDefinitionsRequired { deps: SettingsWriteServiceDeps; input: { definitions: DefinitionInput[]; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface SetValueRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; scope: SettingScope; value: JsonValue; workspaceId?: UUID | undefined; principalId?: UUID | undefined; callerPrincipalId: UUID; authWorkspaceId?: UUID | undefined; requiredPermissionOverride?: string | undefined; }; }
interface ClearValueRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; scope: SettingScope; workspaceId?: UUID | undefined; principalId?: UUID | undefined; callerPrincipalId: UUID; skipAuthorize?: boolean | undefined; skipTransaction?: boolean | undefined; authWorkspaceId?: UUID | undefined; }; }
interface ResetNamespaceRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; scope: Exclude<SettingScope, never>; workspaceId?: UUID | undefined; principalId?: UUID | undefined; callerPrincipalId: UUID; authWorkspaceId?: UUID | undefined; }; }
interface RenameDefinitionRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; workspaceId: UUID | null; newNamespace: string; newKey: string; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface RetypeDefinitionRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; workspaceId: UUID | null; schema: SettingValueSchema; defaultValue: JsonValue | null; coercionTag: string; newNamespace?: string | undefined; newKey?: string | undefined; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface ReconcileDefinitionDefaultRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; workspaceId: UUID | null; defaultValue: JsonValue; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface DeprecateDefinitionRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; workspaceId: UUID | null; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface TombstoneDefinitionRequired { deps: SettingsWriteServiceDeps; input: { namespace: string; key: string; workspaceId: UUID | null; callerPrincipalId: UUID; authWorkspaceId: UUID; }; }
interface PurgeServiceDeps { repo: SettingsRepoPort; clock: Clock; authorize: AuthorizeFn; }
interface PurgeTenantSettingsRequired { deps: PurgeServiceDeps; input: { workspaceId: UUID; principalId?: UUID; callerPrincipalId: UUID; }; }
interface EnsureSettingDefinitionsDeps { settingsRepo: SettingsRepoPort; clock: Clock; ids: IdGenerator; principals: PrincipalRepoPort; }
interface EnsureSettingDefinitionsInput { namespace: string; definitions: readonly SettingDefinitionSpec[]; systemPrincipalId: UUID; }
interface EnsureSettingsUiTabDefinitionsInput { systemPrincipalId: UUID; }
interface SettingsToolDeps { authorize: AuthorizeFn; workspaceId: string; clock: Clock; idGen: { newId(): string }; settingsReady: Promise<void>; settingsUiTabsReady: Promise<void>; settingsRepo: SettingsRepoPort; principalRepo: PrincipalRepoPort; extraDeniedSettings?: readonly AgentSettingWriteRule[]; extraConfirmationSettings?: readonly AgentSettingWriteRule[]; confirmWrite?: (request: SettingsWriteConfirmation) => Promise<boolean>; setValue?: typeof setSettingValue; }
```

- `new InMemorySettingsRepo( seed: { definitions?: SettingDefinitionRecord[]; globalValues?: SettingValueRecord[]; workspaceValues?: SettingValueRecord[]; userValues?: SettingValueRecord[]; revisions?: SettingRevisionRecord[]; } = {} )` → `InMemorySettingsRepo`; methods implement `SettingsRepoPort`.

Wiring (adapters/context are host-provided):

```ts
import { getEffective, set } from "@jini-ai/cms/settings";
const resolved = await getEffective({ repo: settingsRepo },
  { namespace, key, scopeContext: { workspaceId, principalId } });
const written = await set({ deps: { repo: settingsRepo, clock, ids: idGen, authorize, principals },
  input: { namespace, key, scope: "workspace", workspaceId, callerPrincipalId, value } });
```

### `./workspace`

Source: [create.ts](../../src/workspace/create.ts), [update.ts](../../src/workspace/update.ts), [delete.ts](../../src/workspace/delete.ts), [repo.memory.ts](../../src/workspace/repo.memory.ts), [agent-tools.ts](../../src/workspace/agent-tools.ts), [tool-registrations.ts](../../src/workspace/tool-registrations.ts).

```ts
declare function validateWorkspaceNameAndSlug(input: { name: string; slug: string }): { name: string; slug: string };
declare function createWorkspace( required: CreateWorkspaceRequired, _optional: CreateWorkspaceOptional = {} ): Promise<{ id: UUID }>;
declare function updateWorkspace(required: UpdateWorkspaceRequired): Promise<{ workspace: WorkspaceRecord }>;
declare function deleteWorkspace(required: DeleteWorkspaceRequired): Promise<void>;
declare function getWorkspaceAgentToolCatalog(): AgentToolDefinition[];
declare function buildWorkspaceRegistrations(routeDeps: WorkspaceToolDeps): ToolRegistration[];
```

Types/data: `WorkspaceRecord`, `WorkspaceRepoPort`, `CreateWorkspaceInput`, `CreateWorkspaceDeps`, `CreateWorkspaceRequired`, `CreateWorkspaceOptional`, `UpdateWorkspaceInput`, `UpdateWorkspaceDeps`, `UpdateWorkspaceRequired`, `DeleteWorkspaceInput`, `DeleteWorkspaceDeps`, `DeleteWorkspaceRequired`, `WorkspaceAgentToolSideEffect`, `WorkspaceAgentToolActorClassRule`, `WorkspaceAgentToolDefinition`, `WorkspaceToolDeps`, `workspaceDerivedRisk`.

```ts
interface CreateWorkspaceInput { name: string; slug: string; }
interface CreateWorkspaceDeps { idGen: IdGenerator; clock: Clock; repo: WorkspaceRepoPort; outbox: OutboxPort; }
interface CreateWorkspaceRequired { deps: CreateWorkspaceDeps; input: CreateWorkspaceInput; }
interface CreateWorkspaceOptional {}
interface UpdateWorkspaceInput { id: UUID; name?: string | undefined; slug?: string | undefined; }
interface UpdateWorkspaceDeps { repo: WorkspaceRepoPort; }
interface UpdateWorkspaceRequired { deps: UpdateWorkspaceDeps; input: UpdateWorkspaceInput; }
interface DeleteWorkspaceInput { id: UUID; }
interface DeleteWorkspaceDeps { repo: WorkspaceRepoPort; }
interface DeleteWorkspaceRequired { deps: DeleteWorkspaceDeps; input: DeleteWorkspaceInput; }
interface WorkspaceToolDeps { authorize: AuthorizeFn; workspaceId: string; workspaceRepo: WorkspaceRepoPort; }
```

- `new InMemoryWorkspaceRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: WorkspaceRecord[] } = {})` → `InMemoryWorkspaceRepo`; methods implement `WorkspaceRepoPort`.

Wiring (adapters/context are host-provided):

```ts
import { createWorkspace } from "@jini-ai/cms/workspace";
const created = await createWorkspace({ deps: { repo: workspaceRepo, clock, idGen, outbox },
  input: { name: "Editorial", slug: "editorial" } }, {});
```

### `./entries`

Source: [types.ts](../../src/entries/types.ts), [list.ts](../../src/entries/list.ts), [field-validation.ts](../../src/entries/field-validation.ts), [lifecycle-dispatch.ts](../../src/entries/lifecycle-dispatch.ts), [write-service.ts](../../src/entries/write-service.ts), [repo.memory.ts](../../src/entries/repo.memory.ts), [agent-tools.ts](../../src/entries/agent-tools.ts), [tool-registrations.ts](../../src/entries/tool-registrations.ts).

```ts
declare function listEntries( required: { repo: EntryListPort; workspaceId: string }, optional: { type?: string | undefined } = {} ): Promise<{ items: EntryRecord[] }>;
declare function validateFieldsAgainstSchema(required: { schema: ContentTypeFieldDef[]; fieldsJson: unknown; }, optional: { owner?: string | undefined; } = {}): ValidateFieldsResult;
declare function selectVisibleEntryFields(required: { entry: { fieldsJson: unknown }; contentType: { fields: ContentTypeFieldDef[] }; }): Record<string, unknown>;
declare function parseEntryLifecycleOp(requiredArgs: { op: unknown }, optionalArgs: Record<string, never> = {}): EntryLifecycleOp | null;
declare function createEntry(required: CreateEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>>;
declare function updateEntry(required: UpdateEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>>;
declare function importEntry(required: ImportEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>>;
declare function publishEntry(required: PublishUnpublishEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>>;
declare function unpublishEntry(required: PublishUnpublishEntryRequired): Promise<Result<{ entry: EntryRecord }, Error>>;
declare function toEntryOutbox(deps: { outbox: { enqueue(event: { id: string; workspaceId: string; name: string; occurredAt: string; payload: Record<string, unknown>; }): Promise<void>; }; clock: Clock; idGen: { newId(): string }; workspaceId: string; }): OutboxPort;
declare function buildEntriesRegistrations(routeDeps: EntriesToolDeps): ToolRegistration[];
```

Types/data: `EntryStatus`, `EntryFieldsJson`, `EntryRecord`, `OwningContentType`, `ActorIdentityInput`, `Result`, `EntryListPort`, `FieldValidationError`, `ValidateFieldsResult`, `EntryLifecycleOp`, `EntryLifecycleHandler`, `ENTRY_LIFECYCLE_OP_NAMES`, `ENTRY_LIFECYCLE_OPS`, `EntryRevisionInput`, `EntryRepoPort`, `ContentTypeLookupPort`, `OutboxPort`, `WatermarkPort`, `CreateEntryRequired`, `UpdateEntryRequired`, `ImportEntryRequired`, `PublishUnpublishEntryRequired`, `EntriesAgentToolSideEffect`, `EntriesAgentToolDefinition`, `entriesAgentToolCatalog`, `EntriesToolDeps`, `entriesDerivedRisk`.

```ts
interface ActorIdentityInput { actorId: string; principalKind?: "user" | "agent" | "api_key"; delegatedByWorkspaceId?: string | null; delegatedById?: string | null; }
interface EntryRevisionInput { entryId: string; workspaceId: string; op: "create" | "update" | "publish" | "unpublish"; stateJson: EntryRecord; actorId: string; delegatedByWorkspaceId: string | null; delegatedById: string | null; recordedAt: string; }
interface CreateEntryRequired { deps: { entryRepo: EntryRepoPort; contentTypeRepo: ContentTypeLookupPort; clock: Clock; ids: { newId: () => string }; authorize: AuthorizeFn; outbox: OutboxPort; watermark?: WatermarkPort; onWritten?: (entry: EntryRecord) => Promise<void>; }; input: ActorIdentityInput & { workspaceId: string; type: string; slug: string; title: string; fieldsJson: unknown; bodyJson?: unknown; owner?: string | undefined; }; }
interface UpdateEntryRequired { deps: ExistingEntryTransitionDeps; input: ActorIdentityInput & { workspaceId: string; id: string; title?: string | undefined; fieldsJson?: unknown; bodyJson?: unknown; expectedVersion: number; owner?: string | undefined; }; }
interface ImportEntryRequired { deps: { entryRepo: EntryRepoPort; contentTypeRepo: ContentTypeLookupPort; clock: Clock; authorize: AuthorizeFn; outbox: OutboxPort; watermark?: WatermarkPort; onWritten?: (entry: EntryRecord) => Promise<void>; }; input: ActorIdentityInput & { workspaceId: string; id: string; type: string; slug: string; title: string; status: EntryStatus; fieldsJson: unknown; bodyJson?: unknown; publishedAt: string | null; expectedVersion: number | undefined; owner?: string | undefined; }; }
interface PublishUnpublishEntryRequired { deps: ExistingEntryTransitionDeps; input: ActorIdentityInput & { workspaceId: string; id: string; expectedVersion: number }; }
interface EntriesToolDeps { authorize: AuthorizeFn; workspaceId: string; clock: Clock; idGen: { newId(): string }; outbox: OutboxPort; entryRepo: EntryRepoPort & EntryListPort; contentTypeRepo: ContentTypeLookupPort; }
```

- `new InMemoryEntryRepo()` → `InMemoryEntryRepo`; methods implement `EntryRepoPort, EntryListPort`.

Wiring (adapters/context are host-provided):

```ts
import { createEntry } from "@jini-ai/cms/entries";
const result = await createEntry({
  deps: { entryRepo, contentTypeRepo, clock, ids: idGen, authorize, outbox: entryOutbox },
  input: { workspaceId, actorId, type: "article", slug: "hello", title: "Hello",
    fieldsJson: { ext: { site: {} } } },
}); // check result.ok before reading result.value
```

### `./content-types`

Source: [types.ts](../../src/content-types/types.ts), [list.ts](../../src/content-types/list.ts), [field-defs.ts](../../src/content-types/field-defs.ts), [index-provisioning.ts](../../src/content-types/index-provisioning.ts), [write-service.ts](../../src/content-types/write-service.ts), [lifecycle.ts](../../src/content-types/lifecycle.ts), [lifecycle-dispatch.ts](../../src/content-types/lifecycle-dispatch.ts), [cleanup.ts](../../src/content-types/cleanup.ts), [repo.memory.ts](../../src/content-types/repo.memory.ts), [agent-tools.ts](../../src/content-types/agent-tools.ts), [tool-registrations.ts](../../src/content-types/tool-registrations.ts).

```ts
declare function isContentTypeFieldKind(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: ContentTypeFieldKind };
declare function isIndexableFieldKind(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: IndexableFieldKind };
declare function listContentTypes( required: { repo: ContentTypeListPort; workspaceId: string }, _optional: Record<string, never> = {} ): Promise<{ items: ContentTypeRecord[] }>;
declare function parseContentTypeFieldDefs(requiredArgs: { value: unknown }, optionalArgs: Record<string, never> = {}): Result<ContentTypeFieldDef[], Error>;
declare function validateIdentifierGrammar(requiredArgs: { value: string }, optionalArgs: Record<string, never> = {}): boolean;
declare function mapFieldKindToCast(requiredArgs: { kind: ContentTypeFieldKind }, optionalArgs: Record<string, never> = {}): string;
declare function buildQueryableFieldIndexName(params: { workspaceId: string; contentTypeKey: string; fieldName: string; }): string;
declare function resolveFieldIndexTransition(params: { before: FieldIndexState; after: FieldIndexState; }): FieldIndexTransition;
declare function registerContentType( required: RegisterContentTypeRequired ): Promise<Result<{ contentType: ContentTypeRecord }, Error>>;
declare function updateContentTypeFields( required: UpdateContentTypeFieldsRequired ): Promise<Result<{ contentType: ContentTypeRecord }, Error>>;
declare function deprecateContentType( required: DeprecateContentTypeRequired ): Promise<Result<{ contentType: ContentTypeRecord }, Error>>;
declare function reactivateContentType( required: ReactivateContentTypeRequired ): Promise<Result<{ contentType: ContentTypeRecord }, Error>>;
declare function tombstoneContentType( required: TombstoneContentTypeRequired ): Promise<Result<{ contentType: ContentTypeRecord }, Error>>;
declare function parseContentTypeLifecycleOp(requiredArgs: { op: unknown }, optionalArgs: Record<string, never> = {}): ContentTypeLifecycleOp | null;
declare function planCleanup( required: PlanCleanupRequired ): Promise<Result<{ planId: string; planHash: string }, CleanupNotEligibleError>>;
declare function executeCleanup( required: ExecuteCleanupRequired ): Promise<Result<{ removedEntryCount: number }, unknown>>;
declare function toContentTypeOutbox(deps: { outbox: { enqueue(event: { id: string; workspaceId: string; name: string; occurredAt: string; payload: Record<string, unknown>; }): Promise<void>; }; clock: Clock; idGen: { newId(): string }; workspaceId: string; }): OutboxPort;
declare function buildContentTypesRegistrations(routeDeps: ContentTypesToolDeps): ToolRegistration[];
```

Types/data: `IndexableFieldKind`, `StorageOnlyFieldKind`, `ContentTypeFieldKind`, `ContentTypeFieldDef`, `ContentTypeStatus`, `ContentTypeRecord`, `ActorPrincipalKind`, `ActorIdentityInput`, `Result`, `CONTENT_TYPE_SCALAR_KINDS`, `INDEXABLE_FIELD_KINDS`, `STORAGE_ONLY_FIELD_KINDS`, `CONTENT_TYPE_FIELD_KINDS`, `ContentTypeListPort`, `FieldIndexState`, `FieldIndexTransition`, `IDENTIFIER_GRAMMAR_PATTERN`, `ContentTypeRevisionInput`, `ContentTypeRepoPort`, `IndexProvisionerPort`, `OutboxPort`, `WatermarkPort`, `ContentTypeWriteServiceDeps`, `RegisterContentTypeRequired`, `UpdateContentTypeFieldsRequired`, `LifecycleTransitionInput`, `DeprecateContentTypeRequired`, `ReactivateContentTypeRequired`, `TeardownIndexProvisionerPort`, `TombstoneContentTypeRequired`, `ContentTypeLifecycleOp`, `LifecycleDispatchDeps`, `LifecycleDispatchInput`, `ContentTypeLifecycleHandler`, `CONTENT_TYPE_LIFECYCLE_OP_NAMES`, `CONTENT_TYPE_LIFECYCLE_OPS`, `CleanupEligibilityCheckRepoPort`, `PlanCleanupGatewayPort`, `PlanCleanupRequired`, `ExecuteCleanupGatewayPort`, `CleanupRemovalRepoPort`, `ExecuteCleanupRequired`, `ContentTypesAgentToolSideEffect`, `ContentTypesAgentToolActorClassRule`, `ContentTypesAgentToolDefinition`, `contentTypesAgentToolCatalog`, `ContentTypesToolDeps`, `contentTypesDerivedRisk`.

```ts
interface ActorIdentityInput { actorId: string; principalKind?: ActorPrincipalKind; delegatedByWorkspaceId?: string | null; delegatedById?: string | null; }
interface ContentTypeRevisionInput { contentTypeKey: string; workspaceId: string; op: "register" | "field-change"; stateJson: ContentTypeRecord; actorId: string; principalKind: ActorPrincipalKind | null; delegatedByWorkspaceId: string | null; delegatedById: string | null; recordedAt: string; }
interface ContentTypeWriteServiceDeps { repo: ContentTypeRepoPort; clock: Clock; ids: { newId: () => string }; authorize: AuthorizeFn; indexProvisioner: IndexProvisionerPort; outbox: OutboxPort; watermark?: WatermarkPort; }
interface RegisterContentTypeRequired { deps: ContentTypeWriteServiceDeps; input: ActorIdentityInput & { workspaceId: string; key: string; label: string; fields: ContentTypeFieldDef[]; }; }
interface UpdateContentTypeFieldsRequired { deps: ContentTypeWriteServiceDeps; input: ActorIdentityInput & { workspaceId: string; key: string; fields: ContentTypeFieldDef[]; expectedVersion: number; label?: string | undefined; }; }
interface LifecycleTransitionInput { workspaceId: string; actorId: string; key: string; expectedVersion: number; principalKind?: ActorPrincipalKind; }
interface DeprecateContentTypeRequired { deps: { repo: ContentTypeRepoPort; clock: Clock; authorize: AuthorizeFn; outbox: OutboxPort }; input: LifecycleTransitionInput; }
interface ReactivateContentTypeRequired { deps: { repo: ContentTypeRepoPort; clock: Clock; authorize: AuthorizeFn }; input: LifecycleTransitionInput; }
interface TombstoneContentTypeRequired { deps: { repo: ContentTypeRepoPort; clock: Clock; authorize: AuthorizeFn; outbox: OutboxPort; indexProvisioner: TeardownIndexProvisionerPort }; input: LifecycleTransitionInput; }
interface LifecycleDispatchDeps { repo: ContentTypeRepoPort; clock: Clock; authorize: AuthorizeFn; outbox: OutboxPort; indexProvisioner: TeardownIndexProvisionerPort; }
interface LifecycleDispatchInput { workspaceId: string; actorId: string; key: string; expectedVersion: number; principalKind?: ActorPrincipalKind; }
interface PlanCleanupRequired { deps: { repo: CleanupEligibilityCheckRepoPort; gateway: PlanCleanupGatewayPort; clock: Clock; authorize: AuthorizeFn }; input: { workspaceId: string; actorId: string; contentTypeKey: string; exportReference: string }; }
interface ExecuteCleanupRequired { deps: { repo: CleanupRemovalRepoPort; gateway: ExecuteCleanupGatewayPort }; input: { principalId: string; principalKind: string; confirmationToken: string; contentTypeKey: string }; }
interface ContentTypesToolDeps { authorize: AuthorizeFn; workspaceId: string; clock: Clock; idGen: { newId(): string }; outbox: OutboxPort; contentTypeRepo: ContentTypeRepoPort & ContentTypeListPort; contentTypeIndexProvisioner: IndexProvisionerPort & TeardownIndexProvisionerPort; }
```

- `new InMemoryContentTypeRepo()` → `InMemoryContentTypeRepo`; methods implement `ContentTypeRepoPort, ContentTypeListPort`.
- `new NoopContentTypeIndexProvisioner()` → `NoopContentTypeIndexProvisioner`; methods implement `IndexProvisionerPort, TeardownIndexProvisionerPort`.

Wiring (adapters/context are host-provided):

```ts
import { registerContentType } from "@jini-ai/cms/content-types";
const result = await registerContentType({
  deps: { repo: contentTypeRepo, clock, ids: idGen, authorize, indexProvisioner,
    outbox: contentTypeOutbox },
  input: { workspaceId, actorId, key: "article", label: "Article", fields: [] },
});
```

### `./taxonomy`

Source: [validation-chain.ts](../../src/taxonomy/validation-chain.ts), [write-service.ts](../../src/taxonomy/write-service.ts), [list.ts](../../src/taxonomy/list.ts), [merge-term.ts](../../src/taxonomy/merge-term.ts), [repo.memory.ts](../../src/taxonomy/repo.memory.ts), [content-lookup.ts](../../src/taxonomy/content-lookup.ts), [agent-tools.ts](../../src/taxonomy/agent-tools.ts).

```ts
declare function wouldCreateCycle( required: { termId: string; candidateParentId: string; tree: TermTreeLookup }, _optional: Record<string, never> = {} ): boolean;
declare function validateContentJoin( required: { taxonomyId: string; isOnAllowList: boolean; callerWorkspaceId: string; resolvedTermWorkspaceId: string; resolvedContentWorkspaceId: string; suppliedContentType: string; resolvedContentKind: string; }, _optional: Record<string, never> = {} ): void;
declare function validateHierarchyAssignment( required: { childTaxonomyId: string; taxonomyIsHierarchical: boolean; candidateParentId: string | null; resolvedParent: { id: string; taxonomyId: string } | null | "not-applicable"; wouldCreateCycle: (required: { candidateParentId: string }) => boolean; termId: string; }, _optional: Record<string, never> = {} ): void;
declare function isContentTypeOnAllowList(requiredArgs: { contentType: string }, optionalArgs: Record<string, never> = {}): boolean;
declare function createTaxonomy( required: CreateTaxonomyRequired, _optional: Record<string, never> = {} ): Promise<Taxonomy>;
declare function createTerm( required: CreateTermRequired, optional: CreateTermOptional = {} ): Promise<Term>;
declare function importTaxonomy( required: ImportTaxonomyRequired, _optional: Record<string, never> = {} ): Promise<Taxonomy>;
declare function importTerm( required: ImportTermRequired, optional: ImportTermOptional = {} ): Promise<Term>;
declare function renameTerm( required: RenameTermRequired, _optional: Record<string, never> = {} ): Promise<Term>;
declare function assignTerms( required: AssignTermsRequired, _optional: Record<string, never> = {} ): Promise<void>;
declare function unassignTerms( required: UnassignTermsRequired, _optional: Record<string, never> = {} ): Promise<void>;
declare function onContentDeleted( required: OnContentDeletedRequired, _optional: Record<string, never> = {} ): Promise<void>;
declare function deleteTerm( required: DeleteTermRequired, _optional: Record<string, never> = {} ): Promise<{ deletedTermId: string }>;
declare function deleteTaxonomy( required: DeleteTaxonomyRequired, _optional: Record<string, never> = {} ): Promise<{ deletedTaxonomyId: string; deletedTermIds: string[] }>;
declare function listTaxonomiesWithTerms( required: { taxonomies: TaxonomyListPort; terms: TermListPort }, _optional: Record<string, never> = {} ): Promise<{ items: TaxonomyWithTerms[] }>;
declare function planMergeTerm( required: PlanMergeTermRequired, _optional: Record<string, never> = {} ): Promise<{ planId: string; planHash: string; details: MergeTermPlanDetails }>;
declare function confirmMergeTerm( required: ConfirmMergeTermRequired, _optional: Record<string, never> = {} ): Promise<{ token: string }>;
declare function executeMergeTerm( required: ExecuteMergeTermRequired, _optional: Record<string, never> = {} ): Promise<{ mergedCount: number }>;
declare function noopStampWatermark(): void;
declare function toTaxonomyOutbox(deps: { outbox: { enqueue(event: { id: string; workspaceId: string; name: string; occurredAt: string; payload: Record<string, unknown>; }): Promise<void>; }; clock: Clock; idGen: { newId(): string }; workspaceId: string; }): { enqueue: ({ event }: { event: unknown }) => Promise<void> };
declare function createPostBackedContentLookup(deps: { postRepo: ContentRecordLookupPort; workspaceId: string; }): ContentLookupPort;
declare function createEntryBackedContentLookup(deps: { entryRepo: EntryRecordLookupPort; workspaceId: string; }): ContentLookupPort;
declare function createContentLookup(deps: { postRepo: ContentRecordLookupPort; entryRepo: EntryRecordLookupPort; workspaceId: string; }): ContentLookupPort;
```

Types/data: `TermTreeLookup`, `AuthorizeFn`, `Taxonomy`, `Term`, `TaxonomyRepoPort`, `TermRepoPort`, `EntryTermRepoPort`, `ContentLookupPort`, `ContentTypeTaxonomyPolicyPort`, `TAXONOMY_ALLOWED_CONTENT_TYPES`, `TaxonomyRevisionRow`, `TaxonomyRevisionRepoPort`, `WriteServiceDeps`, `CreateTaxonomyRequired`, `CreateTermRequired`, `CreateTermOptional`, `ImportableTaxonomyRepoPort`, `ImportTaxonomyRequired`, `ImportableTermRepoPort`, `ImportTermRequired`, `ImportTermOptional`, `RenameTermRequired`, `AssignTermsRequired`, `UnassignableEntryTermRepoPort`, `UnassignTermsRequired`, `EntryTermsCleanupPort`, `OnContentDeletedRequired`, `DeletableTaxonomyRepoPort`, `DeletableTermRepoPort`, `AssignmentCountEntryTermRepoPort`, `TransactionalRepoPort`, `DeleteTermRequired`, `DeleteTaxonomyRequired`, `TaxonomyListPort`, `TermListPort`, `TaxonomyWithTerms`, `MergeTermPlanDetails`, `PlanMergeTermRequired`, `ConfirmMergeTermRequired`, `ExecuteMergeTermRequired`, `ContentRecordLookupPort`, `EntryRecordLookupPort`, `TaxonomyAgentToolSideEffect`, `TaxonomyAgentToolActorClassRule`, `TaxonomyAgentToolDefinition`, `taxonomyAgentToolCatalog`.

```ts
interface WriteServiceDeps { authorize: AuthorizeFn; clock: Clock; idGen: IdGenerator; taxonomies: TaxonomyRepoPort; terms: TermRepoPort; entryTerms: EntryTermRepoPort; revisions: TaxonomyRevisionRepoPort; stampWatermark: (required: Record<string, never>, optional?: { tx?: unknown }) => Promise<void> | void; outbox: { enqueue: ({ event }: { event: unknown }) => Promise<void> }; workspaceId: string; contentLookup: ContentLookupPort; contentTypeTaxonomyPolicy?: ContentTypeTaxonomyPolicyPort; }
interface CreateTaxonomyRequired { deps: WriteServiceDeps; principalId: string; name: string; hierarchical: boolean; }
interface CreateTermRequired { deps: WriteServiceDeps; principalId: string; taxonomyId: string; name: string; }
interface CreateTermOptional { parentId?: string | null | undefined; }
interface ImportTaxonomyRequired { deps: WriteServiceDeps & { taxonomies: TaxonomyRepoPort & ImportableTaxonomyRepoPort }; principalId: string; id: string; name: string; hierarchical: boolean; expectedVersion: number | undefined; }
interface ImportTermRequired { deps: WriteServiceDeps & { terms: TermRepoPort & ImportableTermRepoPort }; principalId: string; id: string; taxonomyId: string; name: string; expectedVersion: number | undefined; }
interface ImportTermOptional { parentId?: string | null | undefined; }
interface RenameTermRequired { deps: WriteServiceDeps; principalId: string; termId: string; newName: string; }
interface AssignTermsRequired { deps: WriteServiceDeps; principalId: string; contentType: string; contentId: string; termIds: string[]; }
interface UnassignTermsRequired { deps: Omit<WriteServiceDeps, "entryTerms"> & { entryTerms: EntryTermRepoPort & UnassignableEntryTermRepoPort }; principalId: string; contentType: string; contentId: string; termIds: string[]; }
interface OnContentDeletedRequired { event: { workspaceId: string; contentType: string; contentId: string }; entryTerms: EntryTermsCleanupPort; }
interface DeleteTermRequired { deps: WriteServiceDeps & { terms: DeletableTermRepoPort; entryTerms: AssignmentCountEntryTermRepoPort; transaction: TransactionalRepoPort["transaction"]; }; principalId: string; termId: string; }
interface DeleteTaxonomyRequired { deps: WriteServiceDeps & { taxonomies: DeletableTaxonomyRepoPort; terms: TermListPort & DeletableTermRepoPort; entryTerms: AssignmentCountEntryTermRepoPort; transaction: TransactionalRepoPort["transaction"]; }; principalId: string; taxonomyId: string; }
interface PlanMergeTermRequired { principalId: string; principalKind: "user" | "agent" | "api_key"; fromTermId: string; intoTermId: string; computeOverlap: () => Promise<{ overlappingContentCount: number }>; gatewayPlan: (details: MergeTermPlanDetails) => Promise<{ planId: string; planHash: string; details: unknown }>; }
interface ConfirmMergeTermRequired { principalId: string; principalKind: "user" | "agent" | "api_key"; planId: string; planHash: string; gatewayConfirm: (params: { planId: string; planHash: string }) => Promise<{ token: string }>; }
interface ExecuteMergeTermRequired { confirmationToken: string; gatewayExecute: (params: { confirmationToken: string }) => Promise<{ mergedCount: number }>; }
```

- `new InMemoryTaxonomyRepo()` → `InMemoryTaxonomyRepo`; methods implement `TaxonomyRepoPort, TaxonomyListPort`.
- `new InMemoryTermRepo()` → `InMemoryTermRepo`; methods implement `TermRepoPort, TermListPort`.
- `new InMemoryEntryTermRepo()` → `InMemoryEntryTermRepo`; methods implement `EntryTermRepoPort, UnassignableEntryTermRepoPort`.
- `new InMemoryTaxonomyRevisionRepo()` → `InMemoryTaxonomyRevisionRepo`; methods implement `TaxonomyRevisionRepoPort`.
- `new InMemoryContentLookup(requiredArgs: Record<string, never>, optionalArgs: { seed?: Array<{ contentType: string; contentId: string; workspaceId: string; kind: string }> } = {})` → `InMemoryContentLookup`; methods implement `ContentLookupPort`.

Wiring (adapters/context are host-provided):

```ts
import { createTerm } from "@jini-ai/cms/taxonomy";
const term = await createTerm({ deps: taxonomyWriteDeps, principalId, taxonomyId,
  name: "News" }, { parentId: null });
```

### `./presentation`

Source: [presentation.ts](../../src/presentation/presentation.ts), [repo.memory.ts](../../src/presentation/repo.memory.ts).

```ts
declare function getPresentationSettings( required: GetPresentationSettingsRequired, _optional: PresentationOptional = {} ): Promise<{ settings: PresentationSettingsRecord; availableThemeIds: string[] }>;
declare function setActiveTheme( required: SetActiveThemeRequired, _optional: PresentationOptional = {} ): Promise<{ settings: PresentationSettingsRecord; availableThemeIds: string[] }>;
```

Types/data: `ALLOWED_THEME_IDS`, `ThemeId`, `PresentationSettingsRecord`, `PresentationSettingsRepoPort`, `GetPresentationSettingsRequired`, `SetActiveThemeDeps`, `SetActiveThemeRequired`, `PresentationOptional`.

```ts
interface GetPresentationSettingsRequired { deps: { repo: PresentationSettingsRepoPort; availableThemeIds?: readonly string[] | undefined; }; input: { workspaceId: UUID }; }
interface SetActiveThemeDeps { clock: Clock; repo: PresentationSettingsRepoPort; availableThemeIds?: readonly string[] | undefined; }
interface SetActiveThemeRequired { deps: SetActiveThemeDeps; input: { workspaceId: UUID; activeThemeId: string; }; }
interface PresentationOptional {}
```

- `new InMemoryPresentationSettingsRepo(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: PresentationSettingsRecord[] } = {})` → `InMemoryPresentationSettingsRepo`; methods implement `PresentationSettingsRepoPort`.

Wiring (adapters/context are host-provided):

```ts
import { setActiveTheme } from "@jini-ai/cms/presentation";
const result = await setActiveTheme({ deps: { repo: presentationRepo, clock, availableThemeIds },
  input: { workspaceId, activeThemeId: discoveredThemeId } }, {});
```

### `./core/tools`

Source: [args.ts](../../src/core/tools/args.ts).

```ts
declare function requireToolPermission(required: RequireToolPermissionRequired, optional: RequireToolPermissionOptional = {}): Promise<void>;
declare function adaptLegacyAuthorize(required: { authorize: AuthorizeFn }, _optional: Record<string, never> = {}): AuthorizationPort;
```

Types/data: `RequireToolPermissionRequired`, `RequireToolPermissionOptional`, `WithSchemaOnRejectionRequired`, `BuildDomainRegistrationsRequired`, `BuildDomainRegistrationsOptional`.

```ts
interface RequireToolPermissionRequired { authorize: AuthorizationPort; workspaceId: string; principalId: string; permission: string; }
interface RequireToolPermissionOptional { entityType?: string | undefined; entityId?: string | undefined; }
interface WithSchemaOnRejectionRequired<T> { toolId: string; catalog: ReadonlyMap<string, legacy.WirableToolDefinition>; isShapeRejection: (required: { error: unknown }) => boolean; fn: () => Promise<T>; }
interface BuildDomainRegistrationsOptional { unwiredToolIds?: ReadonlySet<string>; }
```

Wiring (adapters/context are host-provided):

```ts
import { requireToolPermission, adaptLegacyAuthorize } from "@jini-ai/cms/core/tools";
await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize }),
  workspaceId, principalId, permission }, { entityType, entityId });
```

### `./media/import`

Source: [ports.ts](../../src/media/import/ports.ts), [fetch-image.ts](../../src/media/import/fetch-image.ts).

```ts
declare function parseImportUrl({ raw }: { raw: string }): URL;
declare function buildImportFilename({ url, contentType }: { url: URL; contentType: string }, { override }: { override?: string } = {}): string;
declare function validateImageBytes({ source, bytes, bytesTruncated, maxBytes, allowedContentTypes, sniffer }: ValidateImageBytesRequired): string;
declare function fetchImage(required: FetchImageRequired, { timeoutMs = 20_000 }: FetchImageOptional = {}): Promise<FetchedImage>;
```

Core-imported types: `HttpRequest`, `HttpResponse`, `HttpClientPort` (not re-exported here). Exported types/data: `OutboundGuardPort`, `ContentSnifferPort`, `ImageImportPolicy`, `ValidateImageBytesRequired`, `FetchImageRequired`, `FetchImageOptional`, `FetchedImage`.

```ts
interface ValidateImageBytesRequired extends ImageImportPolicy { source: URL | string; bytes: Uint8Array; bytesTruncated: boolean; }
interface FetchImageRequired extends ImageImportPolicy { url: string; httpClient: HttpClientPort; outboundGuard: OutboundGuardPort; }
interface FetchImageOptional { timeoutMs?: number; }
```

Wiring (adapters/context are host-provided):

```ts
import { fetchImage } from "@jini-ai/cms/media/import";
const fetched = await fetchImage({ url, httpClient, outboundGuard, sniffer,
  maxBytes: importByteLimit, allowedContentTypes }, { timeoutMs: 20_000 });
```

## Returned objects and data exports

`createNavMenuReadModel` returns `getMenu({workspaceId,menuId})` / `getMenuBySlug({workspaceId,slug})` → `Promise<NavMenuEntry|null>`, `listMenus({workspaceId})` → `Promise<NavMenuEntry[]>`, and `resolveForLocation({context,locationKey})` → `Promise<ResolvedNav|null>`. The model itself has no close method.

Blob stores implement `put(PutBlobInput)` → `Promise<{storageKey}>`, `putIfAbsent(PutBlobInput)` → `Promise<{storageKey,written}>`, `get({storageKey})` → `Promise<Uint8Array>`, `exists({storageKey})` → `Promise<boolean>`, `remove({storageKey})` → `Promise<void>`. `ImageTransformerPort.transform({bytes,params})` returns `Promise<{bytes,contentType}>`; reference and Sharp adapters share this signature. Rendition results are `{outcome:"ok",bytes,contentType} | {outcome:"gone"} | {outcome:"not-found"}`.

Catalog exports are arrays of tool definitions with names, input schemas, permission/side-effect/actor metadata; derived-risk exports are maps keyed by tool ID. Lifecycle dispatch maps pair operation names with handlers of the exported handler type. Numeric defaults, allowlists and regex constants are expanded in `behavior.spec.md`. Settings dictionaries are translation data; `translateSettingsDialog` resolves a locale/key to text, not a component.

Repository method schemas are the exported `*RepoPort` interfaces linked above. Memory adapters expose their methods, plus diagnostic methods/collections where declared in their source; they do not gain stronger persistence/authorization guarantees from these exports. Taxonomy memory repositories without explicit constructors use `new X()`; `InMemoryContentLookup` accepts an empty required object plus optional seed. Settings memory repo retains its one-object optional seed constructor. The package supplies no change-set/revert registry, concrete database adapter, UI component or theme loader. Settings HTTP routes are provided explicitly through `./http/settings`.

## Evidence and unresolved surface

Source evidence is the current export map, barrels and linked declarations. `./widgets` is removed; widget components are owned by UI. Package-local tests were read as behavior evidence and were not executed. Compiled targets and tarball contents were not built or verified. Current ownership/signatures were reconciled with source after the architecture wave.

## ./trash


| Export | Current signature / return | Consumer dependencies |
|---|---|---|
| `computePurgeAfter` | `({ at: string, retentionDays: number }): string` | Explicit policy/time |
| `createTrashService` | `(deps: TrashServiceDeps, optional: TrashServiceOptional = {}): TrashPort` | repo/adapters/idGen/retentionDays/entityPolicy/transaction |
| `bindRemoveEntity` | `({ trash, entityType }): RemoveEntity` | Service and entity type |
| `bindForgetRemovedEntity` | `({ repo, entityType }): ForgetRemovedEntity` | Index cleanup port |
| `createTrashSweep` | `(deps: TrashSweepDeps): TrashSweepOnce` | repo/adapters/transaction/entityPolicy |
| `startTrashSweeper` | `({ sweep, clock, scheduler, leaseOwner }, { intervalMs?, batchSize?, leaseMs?, onError? } = {}): TrashSweeper` | core Clock.nowMs() via nowIso({ clock }); scheduler.schedule({ delayMs, run })/cancel({ handle }) |
| `withFollowUps` | `({ adapter: TrashAdapter }, hooks: TrashFollowUpHooks = {}): TrashAdapter` | Optional afterHide/afterUnhide/beforePurge/afterPurge |
| `new InMemoryTrashRepo` | `({})`; implements TrashRepoPort plus `all({}): TrashItem[]` | No persistence |
| `encodeTrashCursor` | `({ trashedAt: string, id: string }): string` | Base64url encoding |
| `decodeTrashCursor` | `({ cursor: string | null | undefined }): { trashedAt, id } | null` | Lenient decoder |
| `createRecordStoreTrashAdapter<T>` | `(deps: RecordStoreTrashAdapterDeps<T>, { hardDelete? } = {}): TrashAdapter` | entityType/store/hidden/shown/isHidden; T has version |

Trash service methods:

```ts
trash({ workspaceId, entityType, entityId, actor, display, at, expectedVersion }, { priorMarker? } = {}): Promise<TrashMarkerResult>;
restore({ workspaceId, entityType, entityId, at }, { actor? } = {}): Promise<RestoreOutcome>;
list({ workspaceId, now, limit }, { entityTypes?, cursor? } = {}): Promise<TrashPage>;
purgeSelected({ workspaceId, ids, actor, authorizeItem }): Promise<PurgeReport>;
```

TrashActor is principalId/optional pluginId; TrashDisplay is title/optional subtitle. TrashItem captures identity/scope, trashedAt/purgeAfter, actor IDs, display snapshot, nullable entityVersion/priorMarker. Page is items/nullable nextCursor. Marker success has ok/version/optional priorMarker/noop; failure has reason not-found/version-changed, or blocked with code/count. Purge/restore report unions are defined in `src/trash/ports.ts` and explained in `errors.spec.md`.

TrashAdapter exposes hide({ workspaceId, entityId, at, expectedVersion }, { actor? }?), unhide(same, { priorMarker?, actor? }?), and purge({ workspaceId, entityId, expectedVersion }, { actor? }?), returning marker or TrashPurgeOutcome. Expected version is number or null. The record-store port supplies findById({ workspaceId, id }) and save({ record }); transformations receive `{ record, at }`, hidden predicate `{ record }`, and optional hardDelete `{ workspaceId, id }`.

Repo methods: insert({ row }), findByEntity({ workspaceId, entityType, entityId }), findByIds({ workspaceId, ids }), deleteById({ workspaceId, id }), deleteByEntity({ workspaceId, entityType, entityId }), list(required, optional), claimDue({ now, leaseOwner, leaseUntil, limit }), releaseLease({ id }); all asynchronous. Find methods return row/null or rows, list returns TrashPage, claimDue returns TrashSweepClaim[], writes return void. `TransactionRunner({ work }): Promise<T>` must make adapter/index effects atomic; `TrashEntityPolicy({ entityType }): boolean` governs admission.

`TrashServiceOptional` callbacks onChanged({ workspaceId, entityType, entityId, change }) and onError({ error }) are argument 2. `TrashSweepOnce({ now, leaseOwner, leaseUntil, limit }): Promise<TrashSweepReport>`; report has claimed/purged/results. `TrashSweeper.stop({}): Promise<void>` stops scheduling and awaits work. Constants: DEFAULT_TRASH_SWEEP_INTERVAL_MS 3600000, DEFAULT_TRASH_SWEEP_BATCH_SIZE 50, DEFAULT_TRASH_SWEEP_LEASE_MS 300000.

Type exports include all named trash types above, plus TrashEntityType, TrashItemAuthorizer, PurgeItemOutcome, TrashChangeEvent, RestoreOutcome, HideFollowUp, UnhideFollowUp, BeforePurge, AfterPurge, TrashSchedulerPort, TrashRecordStore. `TrashAdapterMissingError` is exported. Follow-up hooks receive workspace/entity/time or prior state and are awaited around successful adapter transitions.

```ts
import { createTrashService, InMemoryTrashRepo } from '@jini-ai/cms/trash';
const trash = createTrashService({ repo: new InMemoryTrashRepo({}), adapters: hostTrashAdapters,
  idGen: { next: () => crypto.randomUUID() }, retentionDays: 30,
  entityPolicy: ({ entityType }) => entityType === 'document', transaction: hostTransaction }, {});
await trash.list({ workspaceId: 'tenant-a', now: new Date().toISOString(), limit: 20 }, {});
```


## ./http/settings


`registerSettingsRoutes(required: SettingsHttpRequired, optional: SettingsHttpOptions = {}) => {dispose():void}`. Required ports: `app.get/post/put/delete`, one `workspaceId`, `ready:Promise<void>`, `service`, `changeFeed`, `principalResolver({request,response}) => {id} | null` sync/async, async `authorize({principalId,workspaceId,permission,entityType}) => {allowed,reason}`, `scheduler.every({intervalMs,callback}) => cancellationCallback`, `routes`, `permissions`. Options: `pollIntervalMs`, `keepaliveIntervalMs`, `reauthorizeIntervalMs`, `revisionPageSize`, `onError({operation,error})`.

`SettingsRoutes` supplies `definitions`, `effective`, `raw`, `value`, `reset`, `events`, `workspaceParam`. `SettingsPermissions` supplies `read`, `readRaw`, `readDefinitions`, `readOtherUser`, `manageDefinitions`, `writeGlobal`, `writeWorkspace`, `writeUserSelf`, `writeUserOther`, `reset:{global,workspace,user}`.

Service async methods: `listDefinitions({workspaceId})`, `effective({namespace,workspaceId,principalId})`, `raw({namespace,key,workspaceId,principalId})`, `set(input)`, `clear(input)`, `reset(input)`, `definitions({items,callerPrincipalId,authWorkspaceId})`. CMS mutation inputs are the current `@jini-ai/cms/settings` write contracts. Returns: definition records, `EffectiveSettingRow[]`, `RawSetting|null`, `{value,revisionSeq}`, `{revisionSeq}`, `{clearedCount,revisionSeqs}`, `{applied:[{key,op,status}]}` or `{unknownOp}` respectively. Feed async `head({}) => number`, `collect({sinceSeq,limit,viewer:{workspaceId,principalId}}) => {namespaces,cursor,examinedCount}`.

Eight endpoints use host-supplied paths: GET/POST definitions; GET effective with `namespace,principalId?`; GET raw with `namespace,key,principalId?`; PUT value `{namespace,key,scope,valueJson,workspaceId?,principalId?}`; DELETE value same without value; POST reset `{namespace,scope,workspaceId?,principalId?}`; GET events with `Last-Event-ID`. Successful reads use `{data}` except raw's `{key,global,workspace,user,default}`; mutations return service results; feed emits `settings-changed` with `{namespaces}`.

Additional exports are **one-object** operations: `createCmsSettingsService({deps: SettingsWriteServiceDeps,permissions}) => SettingsService`; `createCmsSettingsChangeFeed({repo:SettingsRepoPort}) => SettingsChangeFeed`; `resolveTargetWorkspaceId({workspaceId,input:{bodyWorkspaceId,scope}}) => TargetWorkspaceResolution`; `resolveUserLayerReadTarget({deps:{workspaceId,authorize,permission},input:{requestedPrincipalId,callerPrincipalId}}) => Promise<UserLayerReadTarget>`; `settingsWritePermission({permissions,scope,callerPrincipalId,targetPrincipalId}) => string`; `respondToSettingsError({response,error,mappings}) => void`. Public `SettingsErrorMapping` has `matches(error)`, `status`, `code`. Resolution unions are `{ok:true,workspaceId:string|undefined}|{ok:false,error}` and `{allowed:true,principalId:string|undefined}|{allowed:false,reason}`.

```ts
import { createCmsSettingsService, createCmsSettingsChangeFeed, registerSettingsRoutes } from '@jini-ai/cms/http/settings';
const mounted = registerSettingsRoutes({ app, workspaceId, ready, service: createCmsSettingsService({ deps: cmsPorts, permissions }), changeFeed: createCmsSettingsChangeFeed({ repo: cmsPorts.repo }), principalResolver, authorize, scheduler, routes, permissions });
mounted.dispose();
```


## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `AliasDepthExceededError`, `DefinitionNotFoundError`, `DefinitionTombstonedError`, `PrincipalNotFoundError`, `PurgeRequiredError`, `RenameRetypeConflictError`, `ScopeNotAllowedError`, `ValueValidationFailedError` | class; [errors.ts](../../src/settings/errors.ts) |
| `Authorize`, `DefinitionResult`, `PrincipalResolver`, `Scheduler` | type; [contracts.ts](../../src/http/settings/contracts.ts) |
| `ContentRecordNotFoundError`, `TaxonomyHasAssignedContentError`, `TaxonomyRecordNotFoundError`, `TaxonomyVersionConflictError`, `TermHasAssignedContentError`, `TermHasChildTermsError`, `TermRecordNotFoundError` | class; [write-service.ts](../../src/taxonomy/write-service.ts) |
| `ContentTypeAlreadyExistsError`, `ContentTypeLifecycleError`, `ContentTypeNotFoundError`, `ForbiddenError`, `InvalidFieldKindError`, `InvalidFieldNameGrammarError`, `InvalidFieldShapeError`, `InvalidKeyGrammarError`, `QueryableFieldCapExceededError`, `ReservedContentTypeKeyError`, `StorageOnlyFieldNotQueryableError`, `ValidationError`, `VersionConflictError` | class; [errors.ts](../../src/content-types/errors.ts) |
| `ContentTypeMismatchError`, `HierarchyCycleDetectedError`, `ParentCrossTaxonomyError`, `TaxonomyNotApplicableError`, `TaxonomyNotHierarchicalError`, `TermNotFoundError`, `WorkspaceMismatchError` | class; [validation-chain.ts](../../src/taxonomy/validation-chain.ts) |
| `ContentTypeNotActiveError`, `EntryFieldValidationError`, `EntryNotFoundError`, `EntrySlugConflictError` | class; [errors.ts](../../src/entries/errors.ts) |
| `DEFAULT_TRASH_RETENTION_DAYS` | const; [write-service.ts](../../src/trash/write-service.ts) |
| `DuplicateCommandError` | class; [command.ts](../../src/core/commands/command.ts) |
| `EntityNotLiveError` | class; [entity-liveness.ts](../../src/core/entity-liveness.ts) |
| `ImageSourceCorruptError`, `ImageTransformUnavailableError` | class; [image-transformer.sharp.ts](../../src/media/image-transformer.sharp.ts) |
| `MediaConflictError`, `MediaNotFoundError`, `MediaSourceImmutableError`, `MediaStillReferencedError`, `MediaValidationError` | class; [types.ts](../../src/media/types.ts) |
| `MediaImportValidationError` | class; [fetch-image.ts](../../src/media/import/fetch-image.ts) |
| `MenuConflictError`, `MenuLocationBoundError`, `MenuNotFoundError`, `MenuValidationError` | class; [menu-service.ts](../../src/navigation/menu-service.ts) |
| `PresentationSettingsNotFoundError`, `PresentationSettingsValidationError` | class; [presentation.ts](../../src/presentation/presentation.ts) |
| `SameTermMergeError` | class; [merge-term.ts](../../src/taxonomy/merge-term.ts) |
| `SettingsPrincipalLookupPort` | type; [principal-lookup.ts](../../src/settings/principal-lookup.ts) |
| `TransformValidationError` | class; [transform-types.ts](../../src/media/transform-types.ts) |
| `WorkspaceConflictError`, `WorkspaceLastRemainingError`, `WorkspaceNotFoundError`, `WorkspaceValidationError` | class; [create.ts](../../src/workspace/create.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./navigation`, `./media`, `./settings`, `./workspace`, `./entries`, `./content-types`, `./taxonomy`, `./presentation`, `./core/tools`, `./media/import`, `./http/settings`, `./trash`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
