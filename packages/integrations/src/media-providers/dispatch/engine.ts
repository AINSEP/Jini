import { requireMediaHttpClient } from './outbound.js';
import { normalizeMediaProviderMap } from '../providers.js';
import type { RequiredArgs, OptionalArgs } from '../../args.js';
/** Media dispatch validates catalogue inputs, resolves live credentials and returns generated
 * bytes. Registries belong to the host so embedded engines cannot alter each other's routes.
 * Filesystem/project resolution remains outside this engine (locked architecture §2.1).
 */
import { AUDIO_DURATIONS_SEC, VIDEO_LENGTHS_SEC, findMediaModel, findProvider, modelsForSurface } from '../providers.js';
import type { AudioKind, MediaModel, MediaProvider, MediaSurface } from '../types.js';
import { buildRenderContext } from './context.js';

import { renderCustomOpenAIImage, customImageOverridesOpenAIModel } from './providers/custom-image.js';
import { renderStub } from './stub.js';
import type {
  MediaDispatchEngine,
  MediaDispatchEngineRequired,
  VendorAdapterLookup,
  MediaDispatchEngineOptions,
  MediaGenerationRequest,
  MediaGenerationResult,
  ProviderCredentials,
  RenderContext,
  RenderResult,
} from './types.js';
import { dispatchVendorRequest } from './vendor-adapter.js';

const SURFACES: ReadonlySet<MediaSurface> = new Set(['image', 'video', 'audio']);
const AUDIO_KINDS: ReadonlySet<AudioKind> = new Set(['music', 'speech', 'sfx']);

/**
 * Snaps `value` to the nearest entry in `allowed` (exact match wins ties
 * toward the first-listed value) so a hallucinated out-of-range number
 * never reaches a paid provider as-is.
 */
function clampNumber(value: number | undefined, allowed: readonly number[]): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // No empty-array guard: this is only ever called (via clampWithWarning,
  // below) with providers.ts's module-level VIDEO_LENGTHS_SEC/
  // AUDIO_DURATIONS_SEC constants, both proven non-empty by
  // providers.test.ts's "MEDIA_ASPECTS/VIDEO_LENGTHS_SEC/AUDIO_DURATIONS_SEC
  // are non-empty" test — an empty `allowed` is unreachable through this
  // module's only call sites, not a case worth guarding defensively.
  if (allowed.includes(value)) return value;
  let best = allowed[0]!;
  let bestDiff = Math.abs(value - best);
  for (const a of allowed) {
    const d = Math.abs(value - a);
    if (d < bestDiff) {
      best = a;
      bestDiff = d;
    }
  }
  return best;
}

function clampWithWarning(
  value: number | undefined,
  allowed: readonly number[],
  flagName: string,
): { value: number | undefined; warning: string | null } {
  const clamped = clampNumber(value, allowed);
  // `clampNumber` returns a number only for a finite numeric `value`, so a
  // defined `clamped` that differs from `value` is exactly "it moved".
  if (clamped !== undefined && clamped !== value) {
    return { value: clamped, warning: `${flagName} ${value} clamped to ${clamped} (allowed: ${allowed.join(', ')})` };
  }
  return { value: clamped, warning: null };
}

export type Renderer = (required: { ctx: RenderContext; credentials: ProviderCredentials }) => Promise<RenderResult>;

/**
 * Routing table: `providerId` -> `surface` (or `surface:audioKind` for
 * audio) -> renderer, for vendors NOT yet migrated onto the generic
 * vendor-adapter dispatch engine. Mirrors the origin's if/else-if dispatch
 * chain — see `archived provenance ledger` for exactly which (provider, surface) pairs
 * from the origin are ported here vs deferred to a later pass.
 *
 * Empty as of 2026-07-21: every vendor previously listed here
 * (`imagerouter`/`custom-image`/`grok`/`nanobanana`/`openrouter`/
 * `volcengine`/`elevenlabs`/`aihubmix`) has migrated onto
 * host-populated vendor registries (see `builtin-vendors.ts` and each vendor's
 * explicit registration function) — joining `openai`/`minimax`/`senseaudio`/`fishaudio`, migrated the
 * pass before. Kept (not deleted) as `resolveRenderer`'s fallback path for
 * the next vendor this engine wires up.
 */
const ROUTES: Readonly<Record<string, Readonly<Record<string, Renderer>>>> = {};

function routeKeyFor(surface: MediaSurface, audioKind: AudioKind | undefined): string {
  return surface === 'audio' && audioKind ? `audio:${audioKind}` : surface;
}

/**
 * Looks up `providerId`/`routeKey` in a ROUTES-shaped table. Pulled out of
 * `resolveRenderer` into its own pure, exported function (operating on a
 * `routes` parameter rather than closing over the module-level `ROUTES`
 * constant) specifically so its `providerId`-found/not-found and
 * `routeKey`-found/not-found branches stay directly testable even while
 * the production `ROUTES` table itself is empty (every vendor wired into
 * this engine has migrated onto vendor adapters — see `ROUTES`'s own
 * doc comment above): exercising every branch through `resolveRenderer`
 * end-to-end would otherwise need a real, currently-nonexistent
 * ROUTES-only vendor to hit the "found" side. Same "extract to a
 * directly-testable pure function" pattern `context.ts`'s
 * `buildRenderContext` already established for the same reason.
 */
export function lookupRoute(routes: Readonly<Record<string, Readonly<Record<string, Renderer>>>>, providerId: string, routeKey: string): Renderer | undefined {
  return routes[providerId]?.[routeKey];
}

/**
 * Resolves the renderer for `(providerId, routeKey)`: checks
 * the host registry first (vendors migrated onto the generic engine),
 * falling back to the static `ROUTES` table for everything else.
 */
function resolveRenderer({ registry, providerId, routeKey }: { registry: VendorAdapterLookup; providerId: string; routeKey: string }): Renderer | undefined {
  const adapter = registry.get({ providerId, routeKey });
  if (adapter) {
    return ({ ctx, credentials }) => dispatchVendorRequest({ adapter, ctx, credentials });
  }
  return lookupRoute(ROUTES, providerId, routeKey);
}

/** Creates an engine over the host's registry; registration remains live between requests.
 * @returns A generation service; validation, missing routes and provider failures reject generate.
 */
export function createMediaDispatchEngine({ registry, httpClient }: MediaDispatchEngineRequired, options: MediaDispatchEngineOptions = {}): MediaDispatchEngine {
  requireMediaHttpClient({ httpClient });
  const allowStubFallback = options.allowStubFallback === true;

  return {
    async generate(required: RequiredArgs<MediaGenerationRequest>, optional: OptionalArgs<MediaGenerationRequest> = {}): Promise<MediaGenerationResult> {
      // Credentials remain live: a host may rotate them between generation requests.
      const configuredCredentials = options.credentials ? normalizeMediaProviderMap({ providers: options.credentials }) : {};
      const request: MediaGenerationRequest = { ...required, ...optional };
      assertRequestShape(request);
      const { def, resolvedAudioKind } = resolveCatalogModel(request);
      const { length, duration, warnings } = clampRequestInputs(request);
      const ctx = engineRenderContext({ request, resolvedAudioKind, length, duration, options: { ...options, httpClient } });
      const { providerId, renderer, credentials } = selectRenderer({ registry, def, surface: request.surface, resolvedAudioKind, ctx, configuredCredentials });

      if (!renderer) {
        if (!allowStubFallback) {
          throw new Error(
            `no renderer configured for provider "${def.provider}" / surface "${routeKeyFor(request.surface, resolvedAudioKind)}" — pass allowStubFallback: true to get placeholder bytes instead, or wire up a real integration for this pair.`,
          );
        }
        // Every catalogued model's `provider` id resolves via `findProvider` —
        // proven by providers.test.ts's "every model provider id exists in
        // MEDIA_PROVIDERS" catalogue-integrity test, given `def` itself is
        // already a real catalogued model at this point (findMediaModel
        // above didn't throw). Not re-guarded with a runtime null check.
        const provider: MediaProvider = findProvider({ id: def.provider })!;
        const stub = await renderStub({ ctx: ctx, providerId: providerId, integrated: provider.integrated });
        return { ...stub, providerId, usedStubFallback: true, warnings };
      }

      const result = await renderer({ ctx, credentials });
      return { ...result, providerId, usedStubFallback: false, warnings };
    },
  };
}

/** Rejects an unsupported surface, a missing/non-string model, or an unknown audio kind — in that order. */
function assertRequestShape(request: MediaGenerationRequest): void {
  const { surface, model } = request;
  if (!SURFACES.has(surface)) {
    throw new Error(`unsupported surface: ${String(surface)}`);
  }
  if (typeof model !== 'string' || !model) {
    throw new Error('model required');
  }
  if (surface === 'audio' && request.audioKind && !AUDIO_KINDS.has(request.audioKind)) {
    throw new Error(`unsupported audioKind: ${request.audioKind}. Allowed: music | speech | sfx.`);
  }
}

/** Finds the catalogue entry for `request.model` and checks it is registered for the request's surface (and, for audio, the resolved kind — `'music'` by default). */
function resolveCatalogModel(request: MediaGenerationRequest): { def: MediaModel; resolvedAudioKind: AudioKind | undefined } {
  const { surface, model } = request;
  const def: MediaModel | null = findMediaModel({ id: model });
  if (!def) {
    throw new Error(`unknown model: ${model}. Pass a model from the registered catalogue (see @jini-ai/integrations/media-providers's modelsForSurface()).`);
  }
  const resolvedAudioKind = surface === 'audio' ? request.audioKind || 'music' : undefined;
  const allowed = modelsForSurface({ surface: surface }, { audioKind: resolvedAudioKind });
  if (!allowed.some((m) => m.id === model)) {
    const ids = allowed.map((m) => m.id).join(', ');
    const where = surface === 'audio' ? `audio · ${resolvedAudioKind}` : surface;
    throw new Error(`model "${model}" is not registered for surface "${where}". Allowed: ${ids}.`);
  }
  return { def, resolvedAudioKind };
}

const NOT_CLAMPED: { value: number | undefined; warning: string | null } = { value: undefined, warning: null };

/** Clamps `length` for video and `duration` for audio to their registry-allowed values; every other surface/input pair is dropped (left undefined). */
function clampRequestInputs(request: MediaGenerationRequest): { length: number | undefined; duration: number | undefined; warnings: string[] } {
  const length = request.surface === 'video' ? clampWithWarning(request.length, VIDEO_LENGTHS_SEC, 'length') : NOT_CLAMPED;
  const duration = request.surface === 'audio' ? clampWithWarning(request.duration, AUDIO_DURATIONS_SEC, 'duration') : NOT_CLAMPED;
  const warnings = [length.warning, duration.warning].filter((warning): warning is string => warning !== null);
  return { length: length.value, duration: duration.value, warnings };
}

/** The renderer context plus whichever outbound options the host configured on the engine. */
function engineRenderContext(required: {
  request: MediaGenerationRequest;
  resolvedAudioKind: AudioKind | undefined;
  length: number | undefined;
  duration: number | undefined;
  options: MediaDispatchEngineOptions & Pick<MediaDispatchEngineRequired, 'httpClient'>;
}): RenderContext {
  const { request, resolvedAudioKind, length, duration, options } = required;
  return {
    ...buildRenderContext({ request: request, resolvedAudioKind: resolvedAudioKind, length: length, duration: duration }),
    httpClient: options.httpClient,
    ...(options.allowPrivateNetwork === undefined ? {} : { allowPrivateNetwork: options.allowPrivateNetwork }),
    ...(options.outboundMessages === undefined ? {} : { outboundMessages: options.outboundMessages }),
  };
}

/** Picks the provider id, renderer (undefined when none is wired) and credentials for a validated request. */
function selectRenderer(required: {
  registry: VendorAdapterLookup;
  def: MediaModel;
  surface: MediaSurface;
  resolvedAudioKind: AudioKind | undefined;
  ctx: RenderContext;
  configuredCredentials: Readonly<Record<string, ProviderCredentials>>;
}): { providerId: string; renderer: Renderer | undefined; credentials: ProviderCredentials } {
  const { registry, def, surface, resolvedAudioKind, ctx, configuredCredentials } = required;
  // `openai` + image can be overridden by a caller-configured
  // `custom-image` credential that names the same model — mirrors the
  // origin's `customImageOverridesOpenAIModel` precedence.
  if (def.provider === 'openai' && surface === 'image') {
    const override = { ctx, credentials: configuredCredentials['custom-image'] ?? null };
    if (customImageOverridesOpenAIModel(override)) {
      return { providerId: 'custom-image', renderer: renderCustomOpenAIImage, credentials: override.credentials };
    }
  }
  return {
    providerId: def.provider,
    renderer: resolveRenderer({ registry, providerId: def.provider, routeKey: routeKeyFor(surface, resolvedAudioKind) }),
    credentials: configuredCredentials[def.provider] ?? {},
  };
}
