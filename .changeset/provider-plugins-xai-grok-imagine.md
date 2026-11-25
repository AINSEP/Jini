---
"@jini-ai/provider-plugins": minor
---

Add the `xai-grok-imagine` media provider plugin (`./xai-grok-imagine` manifest, `./xai-grok-imagine/media` compiled `createXaiMediaContribution`). It registers the `media` contract and receives the host's generic wire helpers through provider initialization, so image generation and text-to-speech keep their request and response shapes after leaving the built-in dispatch set.
