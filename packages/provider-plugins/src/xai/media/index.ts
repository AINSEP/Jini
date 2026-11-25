/**
 * @file The xAI plugin's `media` contribution (provider-plugin contract `media`): the Grok image and
 * text-to-speech adapters, shaped as one `MediaProviderContribution` for the media-provider registry.
 *
 * Why here: the engine ships no vendor of its own for this row. A host binds it at composition
 * (`createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), createXaiMediaContribution()] })`),
 * so a host that does not contribute it has no Grok availability, and the engine never selects it.
 * The catalogue row and model ids are generic reference data owned by `@jini-ai/integrations`;
 * `catalogMediaProviderContribution` attaches them so media kind ids, list order and availability
 * are the ones the engine registered before this move.
 */
import { catalogMediaProviderContribution, type MediaProviderContribution, type VendorAdapter } from '@jini-ai/integrations/media-providers';
import { grokImageAdapter, xaiTTSAdapter } from './grok.js';

/** The catalogue provider id (not the vendor-plugin id): saved credentials and env maps key on it. */
export const XAI_MEDIA_PROVIDER_ID = 'grok';

/**
 * The xAI media contribution, with the image and `audio:speech` routes bound.
 * @returns A fresh contribution; adapters are the module-level adapter objects.
 * @complexity O(p + m) over the catalogue.
 */
export function createXaiMediaContribution(_required: Record<string, never> = {}): MediaProviderContribution {
  return catalogMediaProviderContribution({
    providerId: XAI_MEDIA_PROVIDER_ID,
    adapters: { image: grokImageAdapter as unknown as VendorAdapter<never>, 'audio:speech': xaiTTSAdapter as unknown as VendorAdapter<never> },
  });
}

export { grokAspectFor, grokImageAdapter, renderGrokImage, renderXAITTS, xaiTTSAdapter } from './grok.js';
