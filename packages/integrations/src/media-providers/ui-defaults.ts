import type { MediaProviderOption, ProviderPreset } from '@jini-ai/core';
import { canonicalMediaProviderId, findProvider, VENDOR_API_BASE_URLS } from './providers.js';

/**
 * An explicit starter catalog for host composition. Sourced by driving the origin's
 * Settings → Media providers
 * panel directly (Playwright) and transcribing its real provider list, base URLs, and default
 * models. Pass this explicitly as `catalog` to `MediaProvidersTab`; Zana or any
 * other host is expected to do so once it has its own provider roster.
 */
/** Default model of every Nano Banana-compatible preset below. */
const NANO_BANANA_MODEL = 'gemini-3.1-flash-image-preview';

const starterCatalog: readonly MediaProviderOption[] = [
  {
    id: 'nano-banana',
    label: 'Nano Banana',
    models: [NANO_BANANA_MODEL],
  },
  {
    id: 'aihubmix',
    label: 'AIHubMix',
    models: [NANO_BANANA_MODEL],
  },
  {
    id: 'custom-image-api',
    label: 'Custom Media API',
    models: [NANO_BANANA_MODEL],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
  },
  {
    id: 'fal-ai',
    label: 'Fal.ai',
    models: [NANO_BANANA_MODEL],
  },
  {
    id: 'fishaudio',
    label: 'FishAudio',
  },
  {
    id: 'imagerouter',
    label: 'ImageRouter',
    models: [NANO_BANANA_MODEL],
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

/**
 * A small, vendor-shaped starting catalog. Deliberately NOT the origin's full
 * ~30-entry list: that list is hand-curated product content that goes stale,
 * and this package's rule for tables like this (see `LanguageTab`) is that the
 * host owns them. Pass these explicitly as `presets` to the UI.
 *
 * `preferredModels` stay empty: models are discovered at runtime (live `listModels`) and the
 * user's saved choice is used, never a hard-coded id. Two reasons, both seen live: a hard-coded
 * first entry goes stale and silently pins new users to an old model generation (the Gemini
 * field once defaulted to an older flash model than the one the operator was running), and a
 * code-picked newer, pricier flagship as the silent default would jump an existing user's cost
 * without them choosing it.
 */
export const DEFAULT_PROVIDER_PRESETS: readonly ProviderPreset<'anthropic' | 'openai' | 'azure' | 'google'>[] = [
  {
    id: 'anthropic',
    title: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: VENDOR_API_BASE_URLS.anthropic,
    preferredModels: [],
    kind: 'protocol',
    apiKeyPrefix: 'sk-ant-',
  },
  {
    id: 'openai',
    title: 'OpenAI',
    protocol: 'openai',
    baseUrl: VENDOR_API_BASE_URLS.openai,
    preferredModels: [],
    kind: 'protocol',
    apiKeyPrefix: 'sk-',
  },
  {
    id: 'azure-openai',
    title: 'Azure OpenAI',
    protocol: 'azure',
    baseUrl: VENDOR_API_BASE_URLS.azure,
    preferredModels: [],
    kind: 'protocol',
    // No `apiKeyPrefix` deliberately: an Azure OpenAI key is a bare hex string with no vendor
    // prefix, so any value here would be a guess — and a wrong prefix claim does not merely stay
    // silent, it lets some OTHER vendor's valid key be announced as Azure's. Its 32 hex characters
    // are also the shortest real key shape in this catalog, which is what sets
    // `MIN_PLAUSIBLE_API_KEY_LENGTH`.
  },
  {
    id: 'google-gemini',
    title: 'Google Gemini',
    protocol: 'google',
    baseUrl: VENDOR_API_BASE_URLS.google,
    preferredModels: [],
    kind: 'protocol',
    // `AIza` + 35 characters is the classic Google key shape, and it is recorded here so a key of
    // this shape is recognised as GOOGLE'S when it turns up in some other provider's field.
    // Emphatically not a test that a Google key must look like this: an operator pasted a real,
    // working Gemini key in a newer shape and the old allowlist told them it was not a Google key.
    apiKeyPrefix: 'AIza',
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    protocol: 'openai',
    baseUrl: VENDOR_API_BASE_URLS.openrouter,
    preferredModels: [],
    kind: 'gateway',
    // Longer than OpenAI's `sk-`, and deliberately so: `apiKeyFormatWarning` resolves a key to the
    // MOST specific prefix that claims it, so `sk-or-v1-…` is attributed here rather than to OpenAI.
    apiKeyPrefix: 'sk-or-',
  },
  {
    id: 'ollama',
    title: 'Ollama',
    protocol: 'openai',
    baseUrl: VENDOR_API_BASE_URLS.ollama,
    preferredModels: [],
    kind: 'gateway',
    requiresApiKey: false,
  },
];

