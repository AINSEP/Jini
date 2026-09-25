import { describe, expect, it } from 'vitest';
import {
  AUDIO_DURATIONS_SEC,
  AUDIO_MODELS_BY_KIND,
  findMediaModel,
  findProvider,
  IMAGE_MODELS,
  MEDIA_ASPECTS,
  MEDIA_PROVIDERS,
  modelsForSurface,
  PROVIDER_CREDENTIAL_ENV_VARS,
  VIDEO_LENGTHS_SEC,
  VIDEO_MODELS,
} from '../providers.js';
// Side-effect import only: `dispatch/engine.js` imports every migrated vendor module
// (`dispatch/providers/*.js`), and each of those calls `mediaVendorRegistry.register(...)`
// at module load. Without this import the registry below would be empty regardless of which
// providers are actually wired, and the adapter-coverage test would be meaningless.
import '../dispatch/engine.js';
import { mediaVendorRegistry } from '../dispatch/vendor-registry.js';

/** Every catalogued model's `provider` field must resolve via `findProvider` — the dispatch engine (`dispatch/engine.ts`) relies on this invariant to treat `findProvider(def.provider)` as non-null once `def` itself came from `findMediaModel`, rather than re-guarding a case the catalogue's own construction already rules out. */
function allCatalogueModels() {
  return [...IMAGE_MODELS, ...VIDEO_MODELS, ...AUDIO_MODELS_BY_KIND.music, ...AUDIO_MODELS_BY_KIND.speech, ...AUDIO_MODELS_BY_KIND.sfx];
}

describe('provider catalogue shape', () => {
  it('every provider has a unique, non-empty id and label', () => {
    const ids = new Set<string>();
    for (const provider of MEDIA_PROVIDERS) {
      expect(provider.id.length).toBeGreaterThan(0);
      expect(provider.label.length).toBeGreaterThan(0);
      expect(ids.has(provider.id)).toBe(false);
      ids.add(provider.id);
    }
  });

  it('every model references a real provider id', () => {
    const providerIds = new Set(MEDIA_PROVIDERS.map((p) => p.id));
    const allModels = [
      ...IMAGE_MODELS,
      ...VIDEO_MODELS,
      ...AUDIO_MODELS_BY_KIND.music,
      ...AUDIO_MODELS_BY_KIND.speech,
      ...AUDIO_MODELS_BY_KIND.sfx,
    ];
    expect(allModels.length).toBeGreaterThan(0);
    for (const model of allModels) {
      expect(providerIds.has(model.provider)).toBe(true);
      expect(model.caps.length).toBeGreaterThan(0);
    }
  });

  it('every credential env var provider id is a real provider id', () => {
    const providerIds = new Set(MEDIA_PROVIDERS.map((p) => p.id));
    for (const [providerId, vars] of Object.entries(PROVIDER_CREDENTIAL_ENV_VARS)) {
      expect(providerIds.has(providerId)).toBe(true);
      expect(vars.length).toBeGreaterThan(0);
    }
  });

  it('MEDIA_ASPECTS/VIDEO_LENGTHS_SEC/AUDIO_DURATIONS_SEC are non-empty', () => {
    expect(MEDIA_ASPECTS.length).toBeGreaterThan(0);
    expect(VIDEO_LENGTHS_SEC.length).toBeGreaterThan(0);
    expect(AUDIO_DURATIONS_SEC.length).toBeGreaterThan(0);
  });

  /**
   * Guards `integrated`'s contract (see its doc comment in `types.ts`): a provider marked
   * `true` must actually resolve to a dispatch adapter, not just claim one in the catalogue.
   * `hyperframes`/`fal`/`leonardo` all shipped `integrated: true` with zero
   * `mediaVendorRegistry.register(...)` anywhere — this is the enum-value-granular check
   * (one assertion per provider id) that `buildDomainRegistrations`'s tool-NAME-granular guard
   * cannot catch, since these three never registered any tool under any name at all.
   *
   * Scoped to providers that actually own a catalogued model (`IMAGE_MODELS`/`VIDEO_MODELS`/
   * `AUDIO_MODELS_BY_KIND`) — `stub` (the fallback renderer itself, not a real vendor) and
   * `tavily` (a research tool with its own working request-shape in `@jini-ai/http-kit`, not a
   * media-generation surface this dispatch engine routes to) are `integrated: true` with no
   * catalogued model and legitimately no `mediaVendorRegistry` entry either.
   */
  it('every integrated provider with a catalogued model has a registered dispatch adapter', () => {
    const providerIdsWithModels = new Set(allCatalogueModels().map((model) => model.provider));
    const registeredProviderIds = new Set(mediaVendorRegistry.list().map(([providerId]) => providerId));
    const claimedButUnregistered = MEDIA_PROVIDERS.filter(
      (provider) => provider.integrated && providerIdsWithModels.has(provider.id) && !registeredProviderIds.has(provider.id),
    ).map((provider) => provider.id);
    expect(claimedButUnregistered).toEqual([]);
  });
});

describe('findMediaModel', () => {
  it('finds an image model by id', () => {
    expect(findMediaModel('gpt-image-2')?.provider).toBe('openai');
  });

  it('finds a video model by id', () => {
    expect(findMediaModel('doubao-seedance-2-0-260128')?.provider).toBe('volcengine');
  });

  it('finds a music/speech/sfx model by id', () => {
    expect(findMediaModel('suno-v5')?.caps).toContain('music');
    expect(findMediaModel('minimax-tts')?.caps).toContain('tts');
    expect(findMediaModel('elevenlabs-sfx')?.caps).toContain('sfx');
  });

  it('returns null for an unknown id', () => {
    expect(findMediaModel('not-a-real-model')).toBeNull();
  });
});

describe('findProvider', () => {
  it('finds a known provider', () => {
    expect(findProvider('fal')?.label).toBe('Fal.ai');
  });

  it('returns null for an unknown provider', () => {
    expect(findProvider('not-a-real-provider')).toBeNull();
  });
});

describe('modelsForSurface', () => {
  it('returns IMAGE_MODELS for "image"', () => {
    expect(modelsForSurface('image')).toBe(IMAGE_MODELS);
  });

  it('returns VIDEO_MODELS for "video"', () => {
    expect(modelsForSurface('video')).toBe(VIDEO_MODELS);
  });

  it('returns music models for "audio" with no audioKind', () => {
    expect(modelsForSurface('audio')).toBe(AUDIO_MODELS_BY_KIND.music);
  });

  it('returns the requested audio kind list', () => {
    expect(modelsForSurface('audio', 'speech')).toBe(AUDIO_MODELS_BY_KIND.speech);
    expect(modelsForSurface('audio', 'sfx')).toBe(AUDIO_MODELS_BY_KIND.sfx);
  });
});
