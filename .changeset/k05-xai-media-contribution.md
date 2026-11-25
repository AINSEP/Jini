---
"@jini-ai/integrations": minor
"@jini-ai/provider-plugins": minor
---

Grok media adapters move from `@jini-ai/integrations` to `@jini-ai/provider-plugins/xai/media` as a host-contributed `media` contribution. Removed from integrations: `renderGrokImage`, `renderXAITTS`, `grokAspectFor` and the built-in Grok registration. Added to integrations: `catalogMediaProviderContribution` and the OpenAI-compatible wire helpers (`buildOpenAIImageUrl`, `bytesFromOpenAICompatibleData`, `jsonPostInit`, `parseOpenAICompatibleJson`, `sniffImageExt`, `standardImageAspectFor`) plus `RenderContext`/`RenderResult` types. Added to provider-plugins: `./xai/media` (`createXaiMediaContribution({ kit })`, `createGrokImageAdapter({ kit })`, `createXaiTTSAdapter({ kit })` and the structural `XaiMediaKit` types). The plugin imports nothing from integrations: the host injects the kit built from the integrations exports above. Hosts must contribute the xAI media contribution to keep Grok availability.
