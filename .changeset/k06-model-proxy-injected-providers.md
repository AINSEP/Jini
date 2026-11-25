---
"@jini-ai/core": minor
"@jini-ai/daemon": minor
"@jini-ai/server": minor
"@jini-ai/provider-plugins": minor
---

The daemon's `/api/proxy/*` model proxy no longer lists providers. `ModelProxyHttpDeps` takes a required `providers: ProxyProviderRegistration[]`; `ModelProxyInternalErrorContext.provider` widens from the five-name union to `string`. Each vendor's request parser and tool-turn call moved to `@jini-ai/provider-plugins/model-proxy-{anthropic,openai,azure,google,ollama}` (`create<Vendor>ProxyRegistration()`), built on the new `@jini-ai/core/contracts/agents/proxy-provider` (registration contract) and `.../proxy-provider-kit` (request-field helpers, moved from daemon's internal `model-proxy-fields`). `@jini-ai/server`'s `modelProxy` feature option gains `providers` and `createLocalNodeDaemon` gains a required `proxyProviders`; the server assembles no vendor registration, the host injects them.
