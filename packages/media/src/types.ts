/**
 * `@jini-ai/media` core type system — the provider/model catalogue shape and the
 * pure, transport-free request-building types layered on top of it.
 *
 * Ported from OD's `apps/daemon/src/media/models.ts` (catalogue
 * shape) and `apps/daemon/src/media-adapters/types.ts` (capability +
 * request-builder shape) — see `source-map.md` for the full provenance.
 * Neither origin file carries any OD domain noun; this is a product-neutral
 * multi-vendor media-generation type system, not an OD concept.
 */

/** The three kinds of media this package's catalogue covers. */
export type MediaSurface = 'image' | 'video' | 'audio';

/** Sub-kind of `'audio'` — audio generation splits into three distinct model families. */
export type AudioKind = 'music' | 'speech' | 'sfx';

/**
 * A third-party media-generation vendor (e.g. OpenAI, Fal.ai, ElevenLabs).
 * Reference/catalogue data, not a live connection — a host resolves
 * `credentialsRequired`/`defaultBaseUrl` into its own credential storage.
 */
export interface MediaProvider {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** Whether this package ships a working request-shape for this provider (vs. a planned/future entry). */
  readonly integrated: boolean;
  readonly defaultBaseUrl?: string;
  readonly docsUrl?: string;
  readonly credentialsRequired?: boolean;
  readonly settingsVisible?: boolean;
  readonly supportsCustomModel?: boolean;
  readonly customModelPlaceholder?: string;
}

/** A specific generation model offered by a `MediaProvider`. */
export interface MediaModel {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly provider: string;
  /** Capability tags, e.g. `t2i`/`i2i`/`inpaint`/`t2v`/`i2v`/`tts`. Open-ended by design — see `source-map.md`. */
  readonly caps: readonly string[];
  readonly default?: boolean;
}

// ── Request-builder layer (mirrors media-adapters/types.ts) ────────────────

/**
 * Request-shape family, keyed off the resolved upstream model name. Each
 * family is a distinct wire shape a real vendor gateway expects — see
 * `video-request.ts` for the branching logic and `source-map.md` for the
 * vendor-verification notes this was ported with.
 */
export type MediaFamily = 'seedance' | 'wan' | 'veo' | 'generic';

export type MediaType = 'video' | 'image' | 'audio';

/** A vendor-specific parameter a caller may pass through, with an optional default. */
export interface ExtraBodyParamDef {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly default?: string | number | boolean;
  readonly description?: string;
}

/**
 * Per-model capability description — the data a `CapabilityRegistry` holds.
 * Field names deliberately align with OpenRouter's `GET /api/v1/videos/models`
 * shape so a future remote-fetched catalogue is a data-source swap, not a
 * reshape (see `source-map.md`).
 */
export interface ModelCapability {
  /** Catalogue id (vendor-aggregator prefixes stripped — see `normalizeModelId`). */
  readonly id: string;
  /** Upstream model name for text-to-X / base generation. */
  readonly apiModel: string;
  /** Upstream model name used when a reference image is present (image-to-X). */
  readonly apiModelI2V?: string;
  readonly mediaType: MediaType;
  readonly caps: readonly string[];
  /** Explicit family override; when omitted the family is derived from the wire model name — see `deriveVideoFamily`. */
  readonly family?: MediaFamily;
  readonly baseUrl?: string;
  readonly supportedDurations?: readonly number[];
  readonly supportedSizes?: readonly string[];
  readonly supportedAspectRatios?: readonly string[];
  readonly supportedResolutions?: readonly string[];
  /** Reference-frame roles the model accepts, e.g. `['first_frame']`. Empty/absent means no image-to-X support. */
  readonly supportedFrameImages?: readonly string[];
  readonly generateAudio?: boolean;
  readonly seed?: boolean;
  readonly allowedPassthroughParameters?: readonly string[];
  readonly extraBodyDefaults?: readonly ExtraBodyParamDef[];
}

/**
 * Unified video-generation request input. The caller resolves any reference
 * image to a data URL before calling — this package performs no I/O.
 */
export interface VideoBuildInput {
  readonly prompt: string;
  readonly durationSeconds?: number;
  readonly aspectRatio?: string;
  readonly size?: string;
  readonly resolution?: string;
  readonly imageRef?: { readonly dataUrl: string };
  readonly extraImageRefs?: readonly { readonly dataUrl: string }[];
  readonly generateAudio?: boolean;
  readonly seed?: number;
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

/** Result of `buildVideoRequest` — transport-free; the caller attaches auth + base URL and performs the fetch. */
export interface BuiltVideoRequest {
  readonly wireModel: string;
  readonly family: MediaFamily;
  readonly pathSuffix: string;
  readonly contentType: string;
  readonly body: Record<string, unknown>;
  readonly hasReference: boolean;
}

/** Best-effort normalized shape of an async-submit / poll response across vendor families. */
export interface NormalizedVideoResponse {
  readonly id?: string;
  readonly status?: string;
  readonly url?: string;
  readonly error?: string;
}
