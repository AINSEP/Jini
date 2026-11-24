import type { MediaProviderOption } from '@jini-ai/core';
import { MEDIA_PROVIDERS, IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS_BY_KIND } from './providers.js';

/**
 * @file The provider roster a "Media providers" credentials screen renders, adapted from the real
 * vendor catalogue in this package's `media-providers`.
 *
 * ## Why not `DEFAULT_MEDIA_PROVIDER_CATALOG`
 *
 * That one is a small curated starter sample, and it spells provider
 * ids differently from the engine that will eventually consume these credentials:
 * `xai-grok-imagine` vs `grok`, `nano-banana` vs `nanobanana`, `fal-ai` vs `fal`, `leonardo-ai` vs
 * `leonardo`, `custom-image-api` vs `custom-image`, `volcengine-ark` vs `volcengine`. The dispatch
 * engine and `PROVIDER_CREDENTIAL_ENV_VARS` both key off the LATTER, so a credential stored under a
 * UI-spelled id would be saved successfully and then never resolve at generation time — a silent
 * failure with no error anywhere. Keying the UI off the engine's own catalogue makes that
 * divergence unrepresentable rather than merely documented; the server rejects the UI spellings
 * too (the host's provider credential store), so both ends agree.
 *
 * ## Why the import is `/catalog` and not `/media-providers`
 *
 * The main this package's `media-providers` entry is a node-runtime barrel — it statically
 * reaches `node:crypto`/`node:fs`/`node:path`, `node:dns`, and `undici` through the dispatch
 * engine. `./media-providers/catalog` exists precisely so a browser bundle can take the vendor list
 * without any of that. Importing from the main entry here would drag the whole generation engine
 * into a browser bundle.
 */

/** Providers the operator can actually configure a credential for.
 *
 * Two exclusions, both deliberate:
 * - `settingsVisible === false` — the vendor's own catalogue entry says it has no settings surface.
 *   `hyperframes` is the only entry with this set: it names a planned local HTML → MP4 renderer
 *   (`integrated: false`), not a working REST endpoint, so there is no API key to collect and no
 *   adapter anywhere in this package to route a credential to yet.
 * - `stub` — the deterministic local placeholder renderer. It takes no credential and exists for
 *   tests; showing it as a configurable vendor would be noise.
 *
 * Everything else stays, INCLUDING vendors with `integrated: false`. Those are real services with
 * real API keys whose request-shape this workspace has not ported yet; an operator can legitimately
 * store the key ahead of that, and hiding them would misrepresent the catalogue as smaller than it
 * is. */
function isConfigurable(provider: (typeof MEDIA_PROVIDERS)[number]): boolean {
  return provider.settingsVisible !== false && provider.id !== "stub";
}

/** Model ids this provider advertises across every surface, de-duplicated and stably ordered.
 *
 * `MediaProviderOption.models` is a flat list with no surface dimension, so image, video, and audio
 * models for one vendor collapse into a single picker. That is the component's shape, not a lossy
 * choice made here — and it is why the list is de-duplicated: a model offered on two surfaces would
 * otherwise appear twice in the dropdown.
 *
 * @complexity O(m) over the catalogue's models, once per provider at module load. */
function modelIdsFor(providerId: string): string[] {
  const everyModel = [...IMAGE_MODELS, ...VIDEO_MODELS, ...Object.values(AUDIO_MODELS_BY_KIND).flat()];
  return [...new Set(everyModel.filter((model) => model.provider === providerId).map((model) => model.id))];
}

/**
 * The real vendor roster, in `MediaProvidersTab`'s own option shape (`MediaProviderOption`).
 *
 * Computed once at module load: `MEDIA_PROVIDERS` is a frozen `as const` literal, so there is
 * nothing to recompute and a stable array identity keeps the tab from re-rendering on it.
 */
export const CONFIGURABLE_MEDIA_PROVIDER_CATALOG: readonly MediaProviderOption[] = MEDIA_PROVIDERS.filter(isConfigurable).map(
  (provider) => {
    const models = modelIdsFor(provider.id);
    return {
      id: provider.id,
      label: provider.label,
      ...(provider.defaultBaseUrl ? { defaultBaseUrl: provider.defaultBaseUrl } : {}),
      ...(models.length > 0 ? { models } : {}),
    };
  }
);
