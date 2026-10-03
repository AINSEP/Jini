Spec ID: SPEC-JINI-INTEGRATIONS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:cadf113075a1da8ec10f963e896d23e147c474887d466800477bd2afd84785a9
spec_mode: reverse_spec


# API Contract: Integrations

## Entry-point registry and notation

| Import suffix after `@jini-ai/integrations` | Runtime | Consumer boundary |
|---|---|---|
| `/media-providers` | Node | Catalog, request building, registries, generation, staging, task and operation stores |
| `/media-providers/catalog` | Universal | Only provider/model reference data, lookup functions, and core media types |
| `/credentialed-http` | Node | Resolver/transport/audit-driven credentialed requests |
| `/webhooks` | Node | Subscriptions, delivery queue orchestration, signing, repository/key ports |

There is no root export. Tables record the current signatures rather than future normalization. `R<T>` means the required fields of T and `O<T>` its optional fields; these are documentation shorthand, not exported helpers. `∅` means no second argument exists. Otherwise the optional column is an object defaulting to `{}`. `P<T>` means `Promise<T>`. All string path/id/name fields below are `string`; flags are `boolean` unless explicitly typed.

## HTTP ports

Core `HttpClientPort.send({ request: HttpRequest }, { redirect?: RequestRedirect }) → P<HttpResponse>` is canonical. The complete request includes its optional `body` and idle/legacy timeout budget; core also exposes total deadline, cancellation and bounded binary response fields. The adapter bounds bodies, enforces egress on every hop, and strips credentials on cross-origin redirects. Import these contracts from `@jini-ai/core/primitives`.

## Credentialed HTTP

| Entry point | Required record | Optional | Return |
|---|---|---|---|
| `parseCredentialSchemesFile` | `{ raw }` | ∅ | `{ ok: true, rules: readonly CredentialSchemeRule[] } \| { ok: false, reason: string }` |
| `detectSelfDescribingAuthScheme` | `{ token, rules: readonly CredentialSchemeRule[] }` | ∅ | `SelfDescribingTokenMatch \| null` |
| `buildAuthorizationHeader` | `{ connection: CredentialConnection, schemes: readonly CredentialSchemeRule[] }` | ∅ | `string` containing secret material |
| `resolveRequestTarget` | `{ resolver: Pick<CredentialResolverPort, 'describe'>, input: { workspaceId, label, url: unknown } }` | ∅ | `P<{ label, url: URL }>` |
| `verifyCustomCredential` | `{ deps: CredentialedRequestDeps, input: { workspaceId, label: unknown } }` | `CredentialedRequestOptions` | `P<CustomCredentialVerificationResult>` |
| `makeCredentialedRequest` | `{ deps: CredentialedRequestDeps, input: MakeCredentialedRequestInput }` | `CredentialedRequestOptions` | `P<CredentialedRequestExecutedResult>` |
| `new ConsoleCredentialedRequestAuditLog` | `{ log: ({ line }) => void, prefix }` | ∅ | `CredentialedRequestAuditPort` |
| `new InMemoryCredentialedRequestAuditLog` | No arguments | ∅ | Audit log exposing mutable `entries: CredentialedRequestAuditEntry[]` |

Both logs implement `record({ entry }): void`. `CredentialedRequestDeps` requires resolver, HTTP client, `clock: { nowIso(): string }`, audit, and scheme registry. `CredentialResolverPort.describe({ workspaceId, label }): P<CredentialTarget | null>` must not decrypt; `resolve({ workspaceId, label }): P<ResolvedCredential | null>` yields `{ baseUrl, additionalHosts: readonly string[], connection: { token, username?: string } }`. The host owns credential storage and workspace authorization. `CredentialSchemeRegistryPort.load({ workspaceId }): P<readonly CredentialSchemeRule[]>` supplies trusted rules `{ id, prefix, scheme }`; no default loader exists. `CredentialSchemeRegistry` is a DTO containing `rules` and `refusals`.

`MakeCredentialedRequestInput` requires workspace id and unknown label/method/url. Options are `{ headers?: unknown, body?: unknown, errorPolicy?: CredentialedRequestErrorPolicyPort, diagnosticMapper?: ({ diagnostic, status: 401 | 403 }) => AuthFailureDiagnostic }`. Error policy has `isEgressRefusal({ error }): boolean` and `describeEgressRefusal({ error }): string`. Audit `record({ entry })` receives label, host, method, numeric status/bodyBytes, timestamp `at`, and optional safe `egressRefusal` text.

An executed result is `{ executed: true, status, headers, bodyText, authDiagnostic? }`. Verification returns `{ status: 'valid' | 'invalid' | 'unreachable', message, checkedAt, authDiagnostic? }`. Diagnostic fields are schemeSent, usernameStored, optional hint/remedyToolId. `CredentialedRequestOutcome` also includes the exported declined DTO `{ executed: false, cancelled, reason?: 'expired' | 'abandoned' }`; this package's request function does not generate that branch. Errors are listed in `errors.spec.md`.

```ts
import { makeCredentialedRequest, InMemoryCredentialedRequestAuditLog }
  from '@jini-ai/integrations/credentialed-http';
const audit = new InMemoryCredentialedRequestAuditLog();
const response = await makeCredentialedRequest({
  deps: { resolver, httpClient, schemeRegistry, audit,
    clock: { nowIso: () => new Date().toISOString() } },
  input: { workspaceId: 'workspace-1', label: 'example', method: 'GET',
    url: 'https://api.example/resources' } });
// resolver, schemeRegistry and httpClient are consumer adapters.
```

## Webhooks

| Entry point | Required record | Optional | Return |
|---|---|---|---|
| `createSubscription` | `{ deps: WebhookSubscriptionDeps, input: CreateSubscriptionInput }` | `{ createdByPluginId?: string \| null }` | `P<{ subscription: WebhookSubscriptionRecord }>` |
| `updateSubscription` | `{ deps, input: UpdateSubscriptionInput }` | Same optional type, ignored | Same subscription result |
| `pauseSubscription` | `{ deps, input: { workspaceId, id } }` | `{ paused?: boolean }` | Same subscription result |
| `deleteSubscription` | `{ deps, input: { workspaceId, id } }` | Subscription optional type, ignored | Same subscription result |
| `enqueueDelivery` | `{ deps: EnqueueDeliveryDeps, input: { event: WebhookSourceEvent } }` | `{}` | `P<{ enqueued: WebhookDeliveryRecord[] }>` |
| `processDueDeliveries` | `{ deps: ProcessDueDeliveriesDeps }` | `{ batchSize?: number, hooks?: readonly WebhookBeforeDispatchHook[], requestTimeoutMs?: number, maxAttempts?: number, random?: () => number }` | `P<ProcessDueDeliveriesResult>` |
| `computeBackoffMs` | `{ attempts: number }` | `{ random?: () => number }` | `number` |
| `signPayload` | `SignPayloadInput` | ∅ | `string` |
| `verifySignature` | `VerifySignatureInput` | ∅ | `boolean` |
| `createFixedSecretSigner` | `{ secrets: ReadonlyMap<string, Buffer>, vocabulary: SignatureVocabulary }` | ∅ | `WebhookSigner` |
| `createKeyringBackedSigner` | `{ keyring: Pick<KeyringPort, 'deriveSigningSecret'>, vocabulary }` | ∅ | `WebhookSigner` |

Create input contains workspaceId, ownerPrincipalId, label, targetUrl, topics, createdByPrincipalId. Update contains workspaceId, id, label, targetUrl, topics. Subscription deps require clock, idGenerator, repo and `isAllowedTarget({ url }): P<boolean>`. Core `Clock.nowMs()` and `IdGenerator.newId()` take no arguments; `nowIso({ clock })` formats stored UTC timestamps.

Enqueue deps require subscriptionRepo, deliveryRepo, envelopeStore, idGenerator, clock. Event shape is `{ id, name: WebhookTopic, workspaceId, occurredAt, payload: JsonObject }`. Process deps require deliveryRepo, subscriptionRepo, envelopeStore, httpClient, signer, header vocabulary and clock. Process result is `{ processed, delivered, failed, dead }`, all numeric counts. `WebhookBeforeDispatchHook` exposes numeric priority and `handle({ subscription, envelope }): P<{ send: boolean, envelope?: WebhookEventEnvelope }>`.

| Supplied port | Current member signatures |
|---|---|
| `WebhookSubscriptionRepoPort` | `insert(record): P<void>`, `save(record): P<void>`, `findById({ workspaceId, id }): P<Record \| null>`, `listByWorkspace({ workspaceId }): P<Record[]>`, `findMatching({ workspaceId, topic }): P<Record[]>`; matching must select active rows |
| `WebhookDeliveryRepoPort` | `enqueue({ record }, { envelope? }): P<void>`, `claimPending({ batchSize, nowIso }): P<Record[]>`, `markDelivered({ workspaceId, id, responseStatus, deliveredAtIso }): P<void>`, `markFailed({ workspaceId, id, error, responseStatus: number \| null, nextStatus: 'failed' \| 'dead', nextAttemptAt }, { deadAtIso? }): P<void>`, `findById({ workspaceId, id }): P<Record \| null>`, `listBySubscription({ workspaceId, subscriptionId, limit }): P<Record[]>` |
| `DeliveryEnvelopeStorePort` | `save({ deliveryId, envelope }): P<void>`, `find({ deliveryId }): P<WebhookEventEnvelope \| null>` |
| `KeyringPort` | `activeKey(): P<RootKeyHandle>`, `deriveSigningSecret({ workspaceId, subscriptionId, version }): P<Uint8Array>`, `derive({ workspaceId, purpose, info }): P<Uint8Array>` |
| `SecretSealerPort` | `seal({ plaintext, key, aad }): P<SealedSecret>`, `open({ sealed }, { aad? }): P<string>` |
| `IntegrationSecretRepoPort` | `insert(record): P<void>`, `findById({ workspaceId, id }): P<IntegrationSecretRecord \| null>`, `listByWorkspace({ workspaceId }): P<IntegrationSecretRecord[]>`, `delete({ workspaceId, id }): P<void>` |
| `WebhookSigner` | `signForSubscription({ subscription, rawBody, timestampSeconds }): P<string>` |

In repo rows, `Record` above means the corresponding subscription/delivery record. All types and DTOs from `webhooks/types.ts` are exported, including package-local `UUID`, `ISODateTime`, `JsonValue`, `JsonObject`, status unions, `SecretVersion`, `WebhookSignature`, secret records and root-key/sealing types. Envelope shape is `{ deliveryId, eventId, topic, workspaceId, occurredAt, data }`. Subscription/delivery row lifecycle fields are described in `state.spec.md`.

`SignatureVocabulary` requires timestampField/signatureField. Signing requires vocabulary, secret Buffer, exact rawBody and timestampSeconds. Verification additionally requires header, nowSeconds, and toleranceSeconds; the exported tolerance constant is 300, but the caller must supply it. `WebhookHeaderVocabulary` requires signature/deliveryId/eventId header names. `MAX_DELIVERY_ATTEMPTS = 8`.

```ts
import { createSubscription, createFixedSecretSigner, processDueDeliveries }
  from '@jini-ai/integrations/webhooks';
const clock = { nowIso: () => new Date().toISOString() };
const { subscription } = await createSubscription({
  deps: { clock, repo: subscriptionRepo, idGenerator, isAllowedTarget },
  input: { workspaceId: 'workspace-1', ownerPrincipalId: 'owner-1', label: 'events',
    targetUrl: 'https://receiver.example/events', topics: ['record.changed'],
    createdByPrincipalId: 'owner-1' } });
const signer = createFixedSecretSigner({
  secrets: new Map([[subscription.id, signingSecret]]),
  vocabulary: { timestampField: 't', signatureField: 'v1' } });
const counts = await processDueDeliveries({ deps: { clock, subscriptionRepo,
  deliveryRepo, envelopeStore, httpClient, signer,
  headers: { signature: 'example-signature', deliveryId: 'example-delivery',
    eventId: 'example-event' } } });
// Supply durable repositories, a guarded transport and a secret Buffer.
```

## Media catalog and pure request APIs

The catalog subpath exports core types `MediaSurface`, `AudioKind`, `MediaProvider`, `MediaModel`, `MediaFamily`, `MediaType`, `ExtraBodyParamDef`, `ModelCapability`, `VideoBuildInput`, `BuiltVideoRequest`, `NormalizedVideoResponse`; reference constants `MEDIA_PROVIDERS`, `IMAGE_MODELS`, `VIDEO_MODELS`, `AUDIO_MODELS_BY_KIND`, `MEDIA_ASPECTS`, `VIDEO_LENGTHS_SEC`, `AUDIO_DURATIONS_SEC`, `PROVIDER_CREDENTIAL_ENV_VARS`; and the first three functions below. The main media subpath exports these plus all remaining media APIs.

| Function | Required record | Optional | Return |
|---|---|---|---|
| `findMediaModel` | `{ id }` | ∅ | `MediaModel \| null` |
| `findProvider` | `{ id }` | ∅ | `MediaProvider \| null` |
| `modelsForSurface` | `{ surface: MediaSurface }` | `{ audioKind?: AudioKind }` | `readonly MediaModel[]` |
| `normalizeModelId` | `{ id }` | ∅ | `string` |
| `createCapabilityRegistry` | `{}` | `{ seed?: readonly ModelCapability[] }` | `CapabilityRegistry` |
| `resolveWireModel` | `{ cap: ModelCapability, hasReference: boolean }` | ∅ | `string` |
| `deriveVideoFamily` | `{ wireModel }` | `{ cap?: ModelCapability }` | `MediaFamily` |
| `snapDuration` | `{ cap, requested: number \| undefined }` | ∅ | `number` |
| `snapResolutionToken` | `{ resolution: string \| undefined, size: string \| undefined }` | ∅ | `string` |
| `snapVeoSize` | `{ size: string \| undefined }` | ∅ | `string` |
| `snapSizeToSupported` | `{ size: string \| undefined, supported: readonly string[] \| undefined }` | ∅ | `string \| undefined` |
| `buildVideoRequest` | `{ cap, input: VideoBuildInput }` | ∅ | `BuiltVideoRequest` |
| `normalizeVideoResponse` | `{ raw: unknown }` | ∅ | `NormalizedVideoResponse` |
| `createAllowlistMediaPolicy` | `{}` | `Partial<MediaExecutionPolicy>` | `MediaPolicy` |
| `createFsAttachmentStaging` | `{ cwd }` | `AttachmentStagingOptions` | `AttachmentStaging` |

`CapabilityRegistry` exposes `get({ id }): ModelCapability | undefined`, `register({ caps }): void`, and no-argument `all(): ModelCapability[]`. `MediaPolicy.evaluate({ surface }, { model? }): MediaPolicyDenial | null` must be invoked and honored by the host before generation. Policy types/default and `MEDIA_CAPABILITY_SEED` are exported. `AttachmentStaging.stage({ imagePaths: readonly string[] }, { uploadRoot?: string | null }): P<string[]>` performs filesystem staging. DI constants `CapabilityRegistryToken`, `MediaTaskStoreToken`, `MediaPolicyToken` identify ports; importing them does not bind implementations.

## Media dispatch, renderers and extension ports

`createMediaDispatchEngine({}, optional: MediaDispatchEngineOptions = {}): MediaDispatchEngine` accepts optional `{ credentials?: Readonly<Record<string, ProviderCredentials>>, allowStubFallback?: boolean }`. Credentials are `{ apiKey?, baseUrl?, model? }`. `generate(required: { surface: MediaSurface, model }, optional: O<MediaGenerationRequest> = {}): P<MediaGenerationResult>` supports prompt/aspect/length/duration/voice/audioKind/language/loop/promptInfluence/imageRef/imageRefs/wireModel/speechFormat/requestInit/onProgress. The result is `{ bytes: Buffer, providerNote, suggestedExt?, providerId, usedStubFallback, warnings: readonly string[] }`. Reference images are data URLs; requestInit currently carries only dispatcher; progress callbacks currently take a positional string. Speech format is mp3/wav/flac/aac/opus.

`buildRenderContext({ request, resolvedAudioKind: AudioKind | undefined, length: number | undefined, duration: number | undefined }): RenderContext` returns the normalized render DTO. RenderContext contains surface/model/wireModel/prompt, aspect/length/duration, voice/audioKind/language/loop/promptInfluence, imageRef/imageRefs, requestInit/speechFormat/onProgress. `RenderContext` and `RenderResult` are reachable in signatures but are not named re-exports of the main barrel; consumers can infer them using `Parameters`/`ReturnType`. RenderResult is `{ bytes: Buffer, providerNote, suggestedExt? }`.

All these renderer exports take one `{ ctx: RenderContext, credentials: ProviderCredentials }` and return `P<RenderResult>`: `renderAIHubMixImage`, `renderAIHubMixTTS`, `renderCustomOpenAIImage`, `renderElevenLabsSfx`, `renderElevenLabsTTS`, `renderFishAudioTTS`, `renderGrokImage`, `renderXAITTS`, `renderImageRouterImage`, `renderImageRouterVideo`, `renderMinimaxTTS`, `renderNanoBananaImage`, `renderOpenAIImage`, `renderOpenAISpeech`, `renderOpenRouterImage`, `renderSenseAudioImage`, `renderSenseAudioTTS`, `renderVolcengineImage`. They bypass catalog/policy orchestration; credentials, model/context validation, and transport policy are caller responsibilities.

| Function/class | Required/current argument | Optional | Return |
|---|---|---|---|
| `resolveProviderCredentialsFromEnv` | `{ providerId, env: NodeJS.ProcessEnv }` | ∅ | `ProviderCredentials` |
| `grokAspectFor`, `openRouterAspectFor` | `{ aspect: string \| undefined }` | ∅ | `string` |
| `imageRouterSizeFor` | `{ aspect: string \| undefined, surface: 'image' \| 'video' }` | ∅ | `string` |
| `customImageOverridesOpenAIModel` | `{ ctx, credentials: ProviderCredentials \| null }` | ∅ | Predicate narrowing credentials to non-null |
| `renderStub` | `{ ctx, providerId, integrated: boolean }` | ∅ | `P<RenderResult>` |
| `svgPlaceholder` | `R<RenderContext>` | `O<RenderContext>` | `string` |
| `dispatchVendorRequest<Meta>` | `{ adapter: VendorAdapter<Meta>, ctx, credentials }` | ∅ | `P<RenderResult>` |
| `requireApiKey` | `{ message }` | ∅ | `VendorCredentialGuard` |
| `new VendorAdapterRegistry`, `createVendorAdapterRegistry` | No arguments | ∅ | Fresh `VendorAdapterRegistry` |
| `createRawBytesParser<Meta>` | `RawBytesParserOptions<Meta>` | ∅ | `VendorResponseParser<Meta>` |
| `createHexEnvelopeAudioParser<Meta extends HexEnvelopeAudioMeta>` | `{ errorTag, providerId }` | ∅ | `VendorResponseParser<Meta>` |
| `isLoopbackApiHost`, `isBlockedExternalApiHostname` | `{ hostname }` | ∅ | `boolean` |
| `validateBaseUrlResolved` | `{ baseUrl }` | `{ lookup?: DnsLookupFn }` | `P<{ ok: true } \| { ok: false, error, forbidden: boolean }>` |
| `assertExternalAssetUrl` | `{ rawUrl }` | `{ lookup? }` | `P<{ ok: true } \| { ok: false, error }>` |
| `assertAndFetchExternalAsset` | `{ url }` | `{ init?: RequestInit, lookup? }` | `P<Response>` |

`CUSTOM_IMAGE_MODEL_ID = 'custom-image'`. `mediaVendorRegistry` is the shared mutable registry. Registry methods are `register({ providerId, routeKey, adapter }): void`, `get({ providerId, routeKey }): VendorAdapter<never> | undefined`, `has({ providerId, routeKey }): boolean`, `list(): ReadonlyArray<readonly [string, string]>`; no optional arguments. A fresh registry is not injected into the default engine; use `dispatchVendorRequest` with an adapter retrieved from it.

A `VendorAdapter` supplies optional `requireCredential({ credentials }): void`, `buildRequest({ ctx, credentials }): { url, init: RequestInit, meta }`, and `parseResponse({ resp, ctx, request }): P<RenderResult>`. These port aliases and `VendorRequest` are exported. Raw parser options require errorTag, zeroBytesMessage, note and suggestedExt; static tags/extensions or object-argument resolvers are accepted. Note receives `{ bytes, meta }`. Hex metadata requires wireModel/voiceId. `DnsLookupFn({ hostname })` returns a promise of readonly `{ address, family }` records.

## Media task and async-operation stores

Current legacy task signatures are explicit: `createInMemoryMediaTaskStore(): MediaTaskStore`; `createSqliteMediaTaskStore(dbPath: string): P<SqliteMediaTaskStore>`. Methods are `create(input: MediaTaskCreateInput): P<MediaTask>`, `get(id: string): P<MediaTask | null>`, `update(id: string, patch: MediaTaskPatch): P<MediaTask | null>`, `listByOwner(ownerRef: string, options: MediaTaskListOptions = {}): P<MediaTask[]>`, `delete(id: string): P<void>`, `reconcileOnBoot(options: MediaTaskReconcileOptions): P<MediaTaskReconcileResult>`. SQLite adds `close(): P<void>`. These positional signatures have not yet adopted the two-object convention. Task input requires id/ownerRef; all task DTO/status/error/patch/list/reconcile types are exported. State fields and transition rules are in `state.spec.md`.

| Async API | Required/current argument | Optional | Return |
|---|---|---|---|
| `createInMemoryAsyncOperationStore` | No arguments | ∅ | `AsyncOperationStore` |
| `createSqliteAsyncOperationStore` | `{ dbPath }` | ∅ | `P<SqliteAsyncOperationStore>`; adds no-argument `close(): P<void>` |
| `assertNoCredentialMaterial` | `{ state: Readonly<Record<string, unknown>> \| null \| undefined }` | ∅ | `void` |
| `hydrateAsyncOperationRecord` | `{ raw: Record<string, unknown> }` | ∅ | `AsyncOperationRecord` |
| `createBearerSigner` | `{ resolve: () => P<ProviderCredentials> \| ProviderCredentials, missingCredentialMessage }` | ∅ | `RequestSigner` |
| `withUnsignedRequestInit` | `{ ctx: { requestInit }, init: RequestInit }` | ∅ | `RequestInit` |
| `createImageRouterVideoPollingAdapter` | `{}` | `ImageRouterVideoConfig`: `{ baseUrl?, wireModel? }` | `PollingVendorAdapter<ImageRouterVideoMeta>` |
| `startOperation<Meta>` | `{ store, signer, adapter, ctx, providerId, routeKey, ownerRef }` | `{ fetchImpl?: typeof fetch, clock?: () => number, newId?: () => string, persistRetryDelaysMs?: readonly number[], maxAttempts?: number, deadlineMs?: number, graceMs?: number }` | `P<StartOperationOutcome>` |
| `pollDueOperations` | `{ store, signer, adapters, resolveContext, leaseOwner, leaseMs: number }` | `{ fetchImpl?, clock?, newId?, persistRetryDelaysMs?, limit?: number }` | `P<PollDueStats>` |
| `recoverAfterRestart` | `{ store, signer, adapters }` | `{ fetchImpl?, clock?, newId?, persistRetryDelaysMs?, now?: number }` | `P<RecoverResult>` |

Store members: `create(R<AsyncOperationCreateInput>, O<AsyncOperationCreateInput> = {}): P<AsyncOperationRecord>`, `get({ id }): P<Record | null>`, `update({ id, patch }, { options?: { leaseOwner?: string } } = {}): P<Record | null>`, `listByOwner({ ownerRef }): P<Record[]>`, `claimDue({ now, leaseOwner, leaseMs }, { limit? } = {}): P<Record[]>`, `releaseLease({ id, leaseOwner }): P<void>`, `reconcileOnBoot({ now }): P<AsyncOperationReconcileResult>`. Required create fields are id/providerId/routeKey/ownerRef/maxAttempts/deadlineAt; optional are nextPollAt/status/state. Record here means AsyncOperationRecord.

Polling adapters declare expectedLatencyClass and optional submitIsIdempotent; supply `buildSubmitRequest({ ctx })`, `parseSubmitResponse({ resp, ctx, request })`, `buildPollRequest({ state, ctx })`, `parsePollResponse({ resp, ctx, state })`. Builders return unsigned `{ url, init, meta }`; parsers return complete/pending or complete/pending/failed unions. `RequestSigner({ request })` resolves a signed `{ url, init }` synchronously or asynchronously. `adapters({ providerId, routeKey })` returns an erased polling adapter or undefined; `resolveContext(row)` is currently positional.

Start outcome is `{ done: true, operationId, result } | { done: false, operationId }`. Poll stats are claimed/completed/failed/pending/unknown counts. Recovery returns leasesReleased/deadlineExpired/unknownCrashGap counts and resubmittable ids. Exported DTOs include operation statuses/record/result/error/create/patch/claim/reconcile types, polling types, runtime deps/params/results, and ImageRouter config/meta. Constants `ASYNC_OPERATION_SCHEMA_VERSION`, `CREDENTIAL_IN_STATE_MESSAGE`, and all five `DEFAULT_*` runtime values are specified in state/behavior/errors files.

```ts
import { createMediaDispatchEngine, createAllowlistMediaPolicy,
  createCapabilityRegistry, MEDIA_CAPABILITY_SEED, buildVideoRequest }
  from '@jini-ai/integrations/media-providers';
const capabilities = createCapabilityRegistry({}, { seed: MEDIA_CAPABILITY_SEED });
const cap = capabilities.get({ id: 'sora-2' })!;
const wire = buildVideoRequest({ cap, input: { prompt: 'A landscape' } });
const policy = createAllowlistMediaPolicy({}, { mode: 'enabled', allowedSurfaces: ['image'] });
const engine = createMediaDispatchEngine({}, { credentials: { openai: { apiKey } } });
const target = { surface: 'image' as const, model: 'gpt-image-2' };
const denial = policy.evaluate({ surface: target.surface }, { model: target.model });
if (denial) throw new Error(denial.message);
const image = await engine.generate(target, { prompt: 'A landscape' });
// Host supplies apiKey, transport policy, and storage for returned bytes.
```

Polling is an explicit host loop; minimal wiring for one operation is:

```ts
import { createInMemoryAsyncOperationStore, createBearerSigner,
  createImageRouterVideoPollingAdapter, startOperation, pollDueOperations }
  from '@jini-ai/integrations/media-providers';
const store = createInMemoryAsyncOperationStore(); // Choose SQLite for restart persistence.
const signer = createBearerSigner({ resolve: resolveCredentials,
  missingCredentialMessage: 'ImageRouter credentials required' });
const adapter = createImageRouterVideoPollingAdapter({});
const started = await startOperation({ store, signer, adapter, ctx,
  providerId: 'imagerouter', routeKey: 'video', ownerRef: 'run-1' });
const tick = await pollDueOperations({ store, signer,
  adapters: ({ providerId, routeKey }) =>
    providerId === 'imagerouter' && routeKey === 'video' ? adapter : undefined,
  resolveContext: () => ctx, leaseOwner: 'worker-1', leaseMs: 30_000 });
// Host supplies RenderContext ctx, a per-tick credential resolver, and tick scheduling.
```

Catalog-only consumers use `import { MEDIA_PROVIDERS, modelsForSurface } from '@jini-ai/integrations/media-providers/catalog'`; this subpath imports no dispatch or filesystem module. A transport adapter can implement `HttpClientPort` via `import type { HttpClientPort } from '@jini-ai/core/primitives'` and serve either credential requests or webhooks with the signatures above.

## Supporting exported types

Credential result aliases are `CustomCredentialCheckStatus` (valid/invalid/unreachable) and `CredentialedRequestDeclinedResult` (the declined outcome above). Webhook `IntegrationId` aliases UUID; `WebhookSubscriptionStatus` and `WebhookDeliveryStatus` name the lifecycles in `state.spec.md`. `WebhookBeforeDispatchResult` is the hook's send/optional envelope record.

Webhook input records are exported as `CreateSubscriptionRequired`, `UpdateSubscriptionRequired`, `PauseSubscriptionRequired`, `DeleteSubscriptionRequired`, `EnqueueDeliveryRequired`, and `ProcessDueDeliveriesRequired`. Companion options are `WebhookSubscriptionOptional`, `PauseSubscriptionOptional`, `EnqueueDeliveryOptional`, and `ProcessDueDeliveriesOptional`; `PauseSubscriptionInput` and `DeleteSubscriptionInput` contain workspaceId/id. These names refer to the operation records in the webhook tables; `EnqueueDeliveryOptional` is empty.

Media policy types include `MediaExecutionMode` (enabled/disabled), `MediaPolicyTarget` (surface/optional model), and `MediaPolicyDenialCode` (the three denials in `errors.spec.md`). `MediaTaskStatus` names queued/running/done/failed/interrupted; `MediaTaskError` contains message/optional status/code.

Media exports include `MediaGenerationRequestInit` (RequestInit dispatcher selection), `MediaImageReference` (`{ dataUrl: string }`), `MediaSpeechFormat` (mp3/wav/flac/aac/opus), `VendorRequestBuilder` (context/credential record to request), `HexEnvelopeAudioParserOptions` (parser configuration), and `DnsLookupAddress` (`{ address: string, family: number }`). Runtime records are named `OperationRuntimeDeps`, `StartOperationParams`, `PollDueParams`, and `RecoverParams`, matching the corresponding runtime function inputs above.

`ExpectedLatencyClass` is fast/slow. `UnsignedVendorRequest<Meta>` has url, RequestInit init, and meta; `SignedVendorRequest` has url/init. `AnyPollingVendorAdapter` erases only the adapter's metadata type. `SubmitOutcome` is complete/result or pending/state/retryAfterMs; `PollOutcome` additionally supports failed/message/code. `AsyncOperationStatus` names the states in `state.spec.md`; `AsyncOperationResult` contains bytesBase64/providerNote/optional suggestedExt, and `AsyncOperationError` contains message/optional status/code. `AsyncOperationPatch` contains optional status, attempts, scheduling, state, result, error and lease fields; `AsyncOperationClaimOptions` requires now/leaseOwner/leaseMs with optional limit.

No package HTTP routes, automatic dependency bindings, UI components, or consumer-specific runtime are exported. Evidence: current `package.json`, four subpath barrels and their source declarations. Tests and extraction reports were inspected; no runtime verification was performed.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `CredentialNotFoundError`, `CredentialedRequestTransportError`, `CredentialedRequestValidationError` | class; [credentialed-request.ts](../../src/credentialed-http/credentialed-request.ts) |
| `DEFAULT_DEADLINE_MS`, `DEFAULT_GRACE_MS`, `DEFAULT_MAX_ATTEMPTS`, `DEFAULT_PERSIST_RETRY_DELAYS_MS`, `DEFAULT_POLL_INTERVAL_MS` | const; [operation-runtime.ts](../../src/media-providers/dispatch/operation-runtime.ts) |
| `DEFAULT_MEDIA_EXECUTION_POLICY` | const; [policy.ts](../../src/media-providers/policy.ts) |
| `DEFAULT_SIGNATURE_TOLERANCE_SECONDS` | const; [signing.ts](../../src/webhooks/signing.ts) |
| `MediaOutboundOptions` | type; [outbound.ts](../../src/media-providers/dispatch/outbound.ts) |
| `WebhookDeliveryVetoedError` | class; [delivery.ts](../../src/webhooks/delivery.ts) |
| `WebhookSubscriptionNotFoundError`, `WebhookSubscriptionValidationError` | class; [subscriptions.ts](../../src/webhooks/subscriptions.ts) |
| `defaultMediaOutboundMessages` | const; [outbound.ts](../../src/media-providers/dispatch/outbound.ts) |

## Current manifest boundary

The current `package.json` exposes `./media-providers`, `./media-providers/catalog`, `./credentialed-http`, `./webhooks`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
