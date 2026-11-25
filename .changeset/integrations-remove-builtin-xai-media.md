---
"@jini-ai/integrations": major
---

Remove the built-in xAI media vendor. Breaking: `renderGrokImage`, `renderXAITTS` and `grokAspectFor` are no longer exported; the `grok` provider row, its three catalogue models, `VENDOR_API_BASE_URLS.grok`, the `xai-grok-imagine` -> `grok` alias, `PROVIDER_CREDENTIAL_ENV_VARS.grok` and the xAI starter entry in `DEFAULT_MEDIA_PROVIDER_CATALOG` are gone. Hosts now inject the vendor as a `media` provider contribution (`@jini-ai/provider-plugins/xai-grok-imagine/media`) built with the new `createMediaWire()` port, and inject legacy ids and environment keys explicitly: `createMediaProviderRegistry({}, { aliases })`, `canonicalMediaProviderId` / `normalizeMediaProviderMap` `{ aliases }`, and `resolveProviderCredentialsFromEnv(_, { envVars, aliases })`.
