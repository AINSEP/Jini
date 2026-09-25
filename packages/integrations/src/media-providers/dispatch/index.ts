export { buildRenderContext } from './context.js';
export { resolveProviderCredentialsFromEnv } from './credentials.js';
export { createMediaDispatchEngine } from './engine.js';
export { renderAIHubMixImage, renderAIHubMixTTS } from './providers/aihubmix.js';
export { renderCustomOpenAIImage, customImageOverridesOpenAIModel, CUSTOM_IMAGE_MODEL_ID } from './providers/custom-image.js';
export { renderElevenLabsSfx, renderElevenLabsTTS } from './providers/elevenlabs.js';
export { renderFishAudioTTS } from './providers/fishaudio.js';
export { renderGrokImage, renderXAITTS, grokAspectFor } from './providers/grok.js';
export { renderImageRouterImage, renderImageRouterVideo, imageRouterSizeFor } from './providers/imagerouter.js';
export { renderMinimaxTTS } from './providers/minimax.js';
export { renderNanoBananaImage } from './providers/nanobanana.js';
export { renderOpenAIImage, renderOpenAISpeech } from './providers/openai.js';
export { renderOpenRouterImage, openRouterAspectFor } from './providers/openrouter.js';
export { renderSenseAudioImage, renderSenseAudioTTS } from './providers/senseaudio.js';
export { renderVolcengineImage } from './providers/volcengine.js';
export { renderStub, svgPlaceholder } from './stub.js';
export { assertAndFetchExternalAsset, assertExternalAssetUrl, isBlockedExternalApiHostname, isLoopbackApiHost, validateBaseUrlResolved } from './ssrf-guard.js';
export type { DnsLookupAddress, DnsLookupFn } from './ssrf-guard.js';
export type {
  MediaDispatchEngine,
  MediaDispatchEngineOptions,
  MediaGenerationRequest,
  MediaGenerationRequestInit,
  MediaGenerationResult,
  MediaImageReference,
  MediaSpeechFormat,
  ProviderCredentials,
} from './types.js';
// The generic vendor-adapter dispatch engine (added 2026-07-21) — see
// `vendor-adapter.ts`'s module doc and `source-map.md` for the design and
// which vendors are registered onto it.
export { dispatchVendorRequest, requireApiKey } from './vendor-adapter.js';
export type { VendorAdapter, VendorCredentialGuard, VendorRequest, VendorRequestBuilder, VendorResponseParser } from './vendor-adapter.js';
export { createVendorAdapterRegistry, mediaVendorRegistry, VendorAdapterRegistry } from './vendor-registry.js';
export { createHexEnvelopeAudioParser, createRawBytesParser } from './response-parsers.js';
// The submit-then-poll tier (added 2026-09-02) — purely additive alongside `VendorAdapter`, for
// vendors that hand back a job handle instead of finishing inside one request/response. See
// `operation-runtime.ts`'s module doc for the persist-before-fetch design.
export {
  ASYNC_OPERATION_SCHEMA_VERSION,
  assertNoCredentialMaterial,
  createInMemoryAsyncOperationStore,
  CREDENTIAL_IN_STATE_MESSAGE,
  hydrateAsyncOperationRecord,
} from './async-operation-store.js';
export type {
  AsyncOperationClaimOptions,
  AsyncOperationCreateInput,
  AsyncOperationError,
  AsyncOperationPatch,
  AsyncOperationReconcileResult,
  AsyncOperationRecord,
  AsyncOperationResult,
  AsyncOperationStatus,
  AsyncOperationStore,
} from './async-operation-store.js';
export { createBearerSigner, withUnsignedRequestInit } from './polling-adapter.js';
export type {
  AnyPollingVendorAdapter,
  ExpectedLatencyClass,
  PollOutcome,
  PollingVendorAdapter,
  RequestSigner,
  SignedVendorRequest,
  SubmitOutcome,
  UnsignedVendorRequest,
} from './polling-adapter.js';
export {
  DEFAULT_DEADLINE_MS,
  DEFAULT_GRACE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_PERSIST_RETRY_DELAYS_MS,
  DEFAULT_POLL_INTERVAL_MS,
  pollDueOperations,
  recoverAfterRestart,
  startOperation,
} from './operation-runtime.js';
export type {
  OperationRuntimeDeps,
  PollDueParams,
  PollDueStats,
  RecoverParams,
  RecoverResult,
  StartOperationOutcome,
  StartOperationParams,
} from './operation-runtime.js';
export { createSqliteAsyncOperationStore } from './sqlite-async-operation-store.js';
export type { SqliteAsyncOperationStore } from './sqlite-async-operation-store.js';
export { createImageRouterVideoPollingAdapter } from './providers/imagerouter-video-async.js';
export type { ImageRouterVideoConfig, ImageRouterVideoMeta } from './providers/imagerouter-video-async.js';
export type { HexEnvelopeAudioMeta, HexEnvelopeAudioParserOptions, RawBytesParserOptions } from './response-parsers.js';
