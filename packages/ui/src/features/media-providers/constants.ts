import { findProvider, canonicalMediaProviderId } from '@jini-ai/integrations/media-providers/catalog';
import type { MediaProviderOption } from './types.js';

/**
 * A small, vendor-shaped starting catalog — same convention as `execution/constants.ts`'s
 * `DEFAULT_PROVIDER_PRESETS`. Sourced by driving Open Design's own Settings → Media providers
 * panel directly (Playwright) and transcribing its real provider list, base URLs, and default
 * models. Pass your own `catalog` to `MediaProvidersTab` to replace this wholesale; Zana or any
 * other host is expected to do so once it has its own provider roster.
 */
const starterCatalog: readonly MediaProviderOption[] = [
  {
    id: 'nano-banana',
    label: 'Nano Banana',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'aihubmix',
    label: 'AIHubMix',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'custom-image-api',
    label: 'Custom Media API',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
  },
  {
    id: 'fal-ai',
    label: 'Fal.ai',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'fishaudio',
    label: 'FishAudio',
  },
  {
    id: 'imagerouter',
    label: 'ImageRouter',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'leonardo-ai',
    label: 'Leonardo.ai',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-image-2', 'dall-e-3'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
  },
  {
    id: 'senseaudio',
    label: 'SenseAudio',
  },
  {
    id: 'tavily-search',
    label: 'Tavily Search',
  },
  {
    id: 'volcengine-ark',
    label: 'Volcengine Ark (Doubao)',
  },
  {
    id: 'xai-grok-imagine',
    label: 'xAI Grok Imagine',
  },
];

export const DEFAULT_MEDIA_PROVIDER_CATALOG: readonly MediaProviderOption[] = starterCatalog.map((entry) => {
  const id = canonicalMediaProviderId({ id: entry.id });
  const provider = findProvider({ id })!;
  return { ...entry, id, label: provider.label, ...(provider.defaultBaseUrl ? { defaultBaseUrl: provider.defaultBaseUrl } : {}) };
});
