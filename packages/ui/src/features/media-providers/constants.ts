import type { MediaProviderOption } from './types.js';

/**
 * A small, vendor-shaped starting catalog — same convention as `execution/constants.ts`'s
 * `DEFAULT_PROVIDER_PRESETS`. Sourced by driving Open Design's own Settings → Media providers
 * panel directly (Playwright) and transcribing its real provider list, base URLs, and default
 * models. Pass your own `catalog` to `MediaProvidersTab` to replace this wholesale; Zana or any
 * other host is expected to do so once it has its own provider roster.
 */
export const DEFAULT_MEDIA_PROVIDER_CATALOG: readonly MediaProviderOption[] = [
  {
    id: 'nano-banana',
    label: 'Nano Banana',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'aihubmix',
    label: 'AIHubMix',
    defaultBaseUrl: 'https://aihubmix.com/v1',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'custom-image-api',
    label: 'Custom Image API',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    defaultBaseUrl: 'https://api.elevenlabs.io',
  },
  {
    id: 'fal-ai',
    label: 'Fal.ai',
    defaultBaseUrl: 'https://fal.run',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'fishaudio',
    label: 'FishAudio',
    defaultBaseUrl: 'https://api.fish.audio',
  },
  {
    id: 'imagerouter',
    label: 'ImageRouter',
    defaultBaseUrl: 'https://api.imagerouter.io/v1/openai',
    models: ['gemini-3.1-flash-image-preview'],
  },
  {
    id: 'leonardo-ai',
    label: 'Leonardo.ai',
    defaultBaseUrl: 'https://cloud.leonardo.ai/api/rest/v1',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.chat/v1',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-image-2', 'dall-e-3'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'senseaudio',
    label: 'SenseAudio',
    defaultBaseUrl: 'https://api.senseaudio.cn',
  },
  {
    id: 'tavily-search',
    label: 'Tavily Search',
    defaultBaseUrl: 'https://api.tavily.com',
  },
  {
    id: 'volcengine-ark',
    label: 'Volcengine Ark (Doubao)',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    id: 'xai-grok-imagine',
    label: 'xAI Grok Imagine',
    defaultBaseUrl: 'https://api.x.ai/v1',
  },
];
