# `@jini-ai/media`

A gateway for generating images, video, and audio across many vendors behind one call. You register
model capabilities (which models exist, what sizes/durations/aspect ratios each accepts, whether it
supports image-to-video), hand a `MediaGenerationRequest` to the dispatch engine, and get bytes back
— with the per-vendor request building, response parsing, size/duration snapping, and SSRF guarding
already done. Generation costs real money, so two things default to *off*: the execution policy denies
everything until a host opts in, and a missing renderer fails closed rather than silently returning a
placeholder.

## Install

```sh
npm install @jini-ai/media
```

No peer dependencies. `@jini-ai/core`, `undici`, and `better-sqlite3` are regular dependencies.
`better-sqlite3` is a **native compiled addon**, but this package only reaches it through a dynamic
`await import('better-sqlite3')` inside `createSqliteMediaTaskStore` — importing anything else from
this package (`renderStub`, the dispatch engine, the catalogue) never touches the native binary at
runtime, so the cost is only paid if you actually call that one factory.

This is also the one package in the workspace with a non-`false` `sideEffects` field: it lists
`./dist/dispatch/engine.js` and `./dist/dispatch/providers/*.js`, whose module-eval vendor
self-registration a bundler must not tree-shake away.

## What you get

**Capability registry** — `createCapabilityRegistry(seed)` → `CapabilityRegistry`
(`get` / `register` / `all`) over `ModelCapability` entries, with `normalizeModelId` (strips a known
aggregator prefix) and `MEDIA_CAPABILITY_SEED` as a starting set.

**Vendor catalogue as reference data** — `MEDIA_PROVIDERS`, `IMAGE_MODELS`, `VIDEO_MODELS`,
`AUDIO_MODELS_BY_KIND`, `MEDIA_ASPECTS`, `VIDEO_LENGTHS_SEC`, `AUDIO_DURATIONS_SEC`,
`PROVIDER_CREDENTIAL_ENV_VARS`, with lookups `findMediaModel`, `findProvider`, `modelsForSurface`.

**Dispatch engine** — `createMediaDispatchEngine({ credentials, allowStubFallback })` →
`MediaDispatchEngine` with a single `generate(request)` → `MediaGenerationResult`
(`{ bytes, providerNote, suggestedExt?, providerId, usedStubFallback, warnings }`).
`resolveProviderCredentialsFromEnv(providerId, env)` fills `ProviderCredentials` from the documented
env-var names. `allowStubFallback` defaults to `false`: with no real renderer for a
(provider, surface) pair, generation throws rather than returning placeholder bytes that could be
mistaken for a real result.

**Per-vendor renderers** — `renderOpenAIImage`, `renderOpenAISpeech`, `renderGrokImage`,
`renderXAITTS`, `renderElevenLabsTTS`, `renderElevenLabsSfx`, `renderFishAudioTTS`,
`renderMinimaxTTS`, `renderNanoBananaImage`, `renderOpenRouterImage`, `renderImageRouterImage`,
`renderImageRouterVideo`, `renderSenseAudioImage`, `renderSenseAudioTTS`, `renderVolcengineImage`,
`renderAIHubMixImage`, `renderAIHubMixTTS`, `renderCustomOpenAIImage`, plus `renderStub` /
`svgPlaceholder` for the deterministic placeholder path.

**Generic vendor-adapter layer** — `VendorAdapterRegistry`, `createVendorAdapterRegistry`, the shared
`mediaVendorRegistry`, `dispatchVendorRequest`, `requireApiKey`, and the
`VendorAdapter` / `VendorRequestBuilder` / `VendorResponseParser` / `VendorCredentialGuard` seams,
with ready-made parsers `createRawBytesParser` and `createHexEnvelopeAudioParser`.

**OpenAI-compatible helpers** — URL builders (`buildOpenAIImageUrl`, `buildOpenAIImageEditUrl`,
`buildOpenAIVideoUrl`, `buildOpenAISpeechUrl`, `buildOpenAICompatibleGenerationUrl`), Azure detection
(`detectAzureEndpoint`, `AZURE_DEFAULT_API_VERSION`, `normalizeOpenAICompatiblePath`), response
handling (`parseOpenAICompatibleJson`, `bytesFromOpenAICompatibleData`), `OPENAI_TTS_VOICES`,
`openaiSizeFor`, `resolveSpeechFormat`, `sniffImageExt`.

**Video request building** — `buildVideoRequest`, `resolveWireModel`, `deriveVideoFamily`,
`normalizeVideoResponse`, and the snapping helpers `snapDuration`, `snapResolutionToken`,
`snapSizeToSupported`, `snapVeoSize` (an out-of-range request is clamped and reported in `warnings`,
not rejected).

**SSRF guard** — `assertExternalAssetUrl`, `assertAndFetchExternalAsset`, `validateBaseUrlResolved`,
`isBlockedExternalApiHostname`, `isLoopbackApiHost`, with an injectable `DnsLookupFn`. Vendor base
URLs and returned asset URLs are both attacker-influenced; these resolve and check them before any
fetch.

**Task store port** — `MediaTaskStore` (`create` / `get` / `update` / `listByOwner` / `delete` /
`reconcileOnBoot`), with `createInMemoryMediaTaskStore()` and the durable
`createSqliteMediaTaskStore(dbPath)` → `SqliteMediaTaskStore` (adds `close()`). `reconcileOnBoot`
marks tasks still `queued`/`running` after a restart as `interrupted`, since nothing can resume them.

**Policy port** — `MediaPolicy` (`evaluate(target)` → denial or `null`),
`createAllowlistMediaPolicy(policy)`, `MediaExecutionPolicy`, and
`DEFAULT_MEDIA_EXECUTION_POLICY` — which is `{ mode: 'disabled' }`. Deny by default is deliberate: a
host must opt in rather than getting unrestricted, real-money generation by omitting a config.

**Attachment staging** — `createFsAttachmentStaging(cwd, options)` → `AttachmentStaging`.

**DI tokens** — `CapabilityRegistryToken`, `MediaTaskStoreToken`, `MediaPolicyToken`.

## Usage

```ts
import {
  createCapabilityRegistry,
  createMediaDispatchEngine,
  createAllowlistMediaPolicy,
  createInMemoryMediaTaskStore,
  resolveProviderCredentialsFromEnv,
  MEDIA_CAPABILITY_SEED,
} from '@jini-ai/media';

const registry = createCapabilityRegistry(MEDIA_CAPABILITY_SEED);

// Deny-by-default: this must be opted into explicitly.
const policy = createAllowlistMediaPolicy({
  mode: 'enabled',
  allowedSurfaces: ['image'],
  allowedModels: ['dall-e-3'],
});

const denial = policy.evaluate({ surface: 'image', model: 'dall-e-3' });
if (denial) throw new Error(`${denial.code}: ${denial.message}`);

const engine = createMediaDispatchEngine({
  credentials: { openai: resolveProviderCredentialsFromEnv('openai') },
  // allowStubFallback stays false — a missing renderer must fail, not fake a result.
});

const result = await engine.generate({
  surface: 'image',
  model: 'dall-e-3',
  prompt: 'a lighthouse at dusk',
  aspect: '16:9',
});

console.log(result.providerId, result.bytes.length, result.warnings);

const tasks = createInMemoryMediaTaskStore();
await tasks.reconcileOnBoot({ terminalTtlMs: 7 * 24 * 60 * 60 * 1000 });
```

`MediaGenerationRequest`, `ModelCapability`, and `MediaTaskCreateInput` are the types to read for
their full field sets — `MediaGenerationRequest` in particular carries a dozen optional dials
(`duration`, `voice`, `audioKind`, `language`, `loop`, `imageRef`, …) beyond the four used above.

## What's swappable

Three DI-token ports: `MediaTaskStore` (in-memory reference vs. the SQLite adapter vs. your own),
`MediaPolicy` (the allowlist gate is explicitly "a reference implementation, not the only possible
one"), and `CapabilityRegistry`. Below that, the vendor layer is injection-first: `VendorAdapter` /
`VendorRequestBuilder` / `VendorResponseParser` / `VendorCredentialGuard` let a new vendor be added
without touching the engine, `createVendorAdapterRegistry()` gives you a private registry instead of
the shared `mediaVendorRegistry`, `DnsLookupFn` makes the SSRF guard testable, and
`MediaGenerationRequestInit` lets you supply your own `undici` dispatcher for pooling and timeouts.
`ProviderCredentials` are passed in, never read from the environment implicitly — you call
`resolveProviderCredentialsFromEnv` yourself if you want that. Fixed: each vendor's actual HTTP
contract, the SSRF blocklist rules, and the snapping logic.

## Runtime

`jini.runtime: "node"` — `Buffer`, `undici`, `node:dns` for the SSRF guard, `node:fs` for attachment
staging.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance, exactly which vendors are ported versus
deferred, and this package's maturity status. Apache-2.0, inherited from Open Design — see the repo
`NOTICE`.
