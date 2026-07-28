/**
 * The media dispatch engine — validates a generation request against the
 * catalogue, clamps registry-bound numeric inputs, resolves per-provider
 * credentials, and routes to the matching renderer (or a deterministic
 * placeholder when `allowStubFallback` is set and no real renderer is
 * wired up for the pair). Generalized from Open Design's
 * `apps/daemon/src/media/index.ts` `generateMedia` orchestration — see
 * `types.ts`'s module doc for the boundary redesign (no filesystem I/O,
 * no OD project resolution) and `source-map.md` for the full port record.
 *
 * 2026-07-21: renderer resolution now checks `vendor-registry.ts`'s
 * `mediaVendorRegistry` first (populated by every vendor migrated onto the
 * generic vendor-adapter dispatch engine — see `vendor-adapter.ts`'s
 * module doc), falling back to the static `ROUTES` table below for vendors
 * not yet migrated. Every vendor wired into this engine as of this pass
 * (`openai`/`minimax`/`senseaudio`/`fishaudio`/`imagerouter`/`custom-image`/
 * `grok`/`nanobanana`/`openrouter`/`volcengine`/`elevenlabs`/`aihubmix`) is
 * now registered in `mediaVendorRegistry` instead — every module below is
 * imported for its registration side effect only (not by name), except
 * `custom-image.js`, whose `renderCustomOpenAIImage`/
 * `customImageOverridesOpenAIModel` exports are still referenced directly
 * by the openai-image-override branch further down. `ROUTES` itself is
 * therefore empty right now — kept as the fallback mechanism `resolveRenderer`
 * still checks second, for whichever vendor is ported next without going
 * through the registry (e.g. one of the async-polling vendors in
 * `source-map.md`'s deferred bucket, if a future pass chooses not to build
 * its own polling-aware adapter shape).
 */
import { AUDIO_DURATIONS_SEC, VIDEO_LENGTHS_SEC, findMediaModel, findProvider, modelsForSurface } from '../providers.js';
import type { AudioKind, MediaModel, MediaProvider, MediaSurface } from '../types.js';
import { buildRenderContext } from './context.js';
import './providers/aihubmix.js';
import { renderCustomOpenAIImage, customImageOverridesOpenAIModel } from './providers/custom-image.js';
import './providers/elevenlabs.js';
import './providers/fishaudio.js';
import './providers/grok.js';
import './providers/imagerouter.js';
import './providers/minimax.js';
import './providers/nanobanana.js';
import './providers/openai.js';
import './providers/openrouter.js';
import './providers/senseaudio.js';
import './providers/volcengine.js';
import { renderStub } from './stub.js';
import type {
  MediaDispatchEngine,
  MediaDispatchEngineOptions,
  MediaGenerationRequest,
  MediaGenerationResult,
  ProviderCredentials,
  RenderContext,
  RenderResult,
} from './types.js';
import { dispatchVendorRequest } from './vendor-adapter.js';
import { mediaVendorRegistry } from './vendor-registry.js';

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
  if (typeof value === 'number' && Number.isFinite(value) && typeof clamped === 'number' && clamped !== value) {
    return { value: clamped, warning: `${flagName} ${value} clamped to ${clamped} (allowed: ${allowed.join(', ')})` };
  }
  return { value: clamped, warning: null };
}

export type Renderer = (ctx: RenderContext, credentials: ProviderCredentials) => Promise<RenderResult>;

/**
 * Routing table: `providerId` -> `surface` (or `surface:audioKind` for
 * audio) -> renderer, for vendors NOT yet migrated onto the generic
 * vendor-adapter dispatch engine. Mirrors the origin's if/else-if dispatch
 * chain — see `source-map.md` for exactly which (provider, surface) pairs
 * from the origin are ported here vs deferred to a later pass.
 *
 * Empty as of 2026-07-21: every vendor previously listed here
 * (`imagerouter`/`custom-image`/`grok`/`nanobanana`/`openrouter`/
 * `volcengine`/`elevenlabs`/`aihubmix`) has migrated onto
 * `vendor-registry.ts`'s `mediaVendorRegistry` (see `resolveRenderer`
 * below and each vendor's own module for its `mediaVendorRegistry.register(...)`
 * call) — joining `openai`/`minimax`/`senseaudio`/`fishaudio`, migrated the
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
 * this engine has migrated onto `mediaVendorRegistry` — see `ROUTES`'s own
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
 * `mediaVendorRegistry` first (vendors migrated onto the generic engine),
 * falling back to the static `ROUTES` table for everything else.
 */
function resolveRenderer(providerId: string, routeKey: string): Renderer | undefined {
  const adapter = mediaVendorRegistry.get(providerId, routeKey);
  if (adapter) {
    return (ctx, credentials) => dispatchVendorRequest(adapter, ctx, credentials);
  }
  return lookupRoute(ROUTES, providerId, routeKey);
}

export function createMediaDispatchEngine(options: MediaDispatchEngineOptions = {}): MediaDispatchEngine {
  const allowStubFallback = options.allowStubFallback === true;

  return {
    async generate(request: MediaGenerationRequest): Promise<MediaGenerationResult> {
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

      const def: MediaModel | null = findMediaModel(model);
      if (!def) {
        throw new Error(`unknown model: ${model}. Pass a model from the registered catalogue (see @jini-ai/media's modelsForSurface()).`);
      }
      const resolvedAudioKind = surface === 'audio' ? request.audioKind || 'music' : undefined;
      const allowed = modelsForSurface(surface, resolvedAudioKind);
      if (!allowed.some((m) => m.id === model)) {
        const ids = allowed.map((m) => m.id).join(', ');
        const where = surface === 'audio' ? `audio · ${resolvedAudioKind}` : surface;
        throw new Error(`model "${model}" is not registered for surface "${where}". Allowed: ${ids}.`);
      }

      const warnings: string[] = [];
      let length: number | undefined;
      let duration: number | undefined;
      if (surface === 'video') {
        const clamp = clampWithWarning(request.length, VIDEO_LENGTHS_SEC, 'length');
        length = clamp.value;
        if (clamp.warning) warnings.push(clamp.warning);
      }
      if (surface === 'audio') {
        const clamp = clampWithWarning(request.duration, AUDIO_DURATIONS_SEC, 'duration');
        duration = clamp.value;
        if (clamp.warning) warnings.push(clamp.warning);
      }

      // Every catalogued model's `provider` id resolves via `findProvider` —
      // proven by providers.test.ts's "every model provider id exists in
      // MEDIA_PROVIDERS" catalogue-integrity test, given `def` itself is
      // already a real catalogued model at this point (findMediaModel
      // above didn't throw). Not re-guarded with a runtime null check.
      const provider: MediaProvider = findProvider(def.provider)!;
      const ctx: RenderContext = buildRenderContext(request, resolvedAudioKind, length, duration);

      const credentials = options.credentials?.[def.provider] ?? {};

      // `openai` + image can be overridden by a caller-configured
      // `custom-image` credential that names the same model — mirrors the
      // origin's `customImageOverridesOpenAIModel` precedence.
      let providerId = def.provider;
      let renderer: Renderer | undefined;
      let effectiveCredentials = credentials;
      if (def.provider === 'openai' && surface === 'image') {
        const customImageCredentials = options.credentials?.['custom-image'] ?? null;
        if (customImageOverridesOpenAIModel(ctx, customImageCredentials)) {
          providerId = 'custom-image';
          renderer = renderCustomOpenAIImage;
          effectiveCredentials = customImageCredentials;
        }
      }
      if (!renderer) {
        renderer = resolveRenderer(def.provider, routeKeyFor(surface, resolvedAudioKind));
      }

      if (!renderer) {
        if (!allowStubFallback) {
          throw new Error(
            `no renderer configured for provider "${def.provider}" / surface "${routeKeyFor(surface, resolvedAudioKind)}" — pass allowStubFallback: true to get placeholder bytes instead, or wire up a real integration for this pair.`,
          );
        }
        const stub = await renderStub(ctx, providerId, provider.integrated);
        return { ...stub, providerId, usedStubFallback: true, warnings };
      }

      const result = await renderer(ctx, effectiveCredentials);
      return { ...result, providerId, usedStubFallback: false, warnings };
    },
  };
}
