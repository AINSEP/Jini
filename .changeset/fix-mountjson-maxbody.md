---
"@jini-ai/http-kit": patch
"@jini-ai/core": patch
"@jini-ai/daemon": patch
---

A JSON route's declared `maxBodyBytes` is no longer silently lost. `mountJsonRoute` (http-kit) now enforces it on the body the host parser already read, answering 413 with the plain-words `PAYLOAD_TOO_LARGE` refusal, and http-kit's `JsonRouteSpec`/`defineJsonRoute` accept the field. The daemon's `gatedJsonRoute` keeps a spec cap tighter than the host's instead of overwriting it. On both paths a spec cap larger than the host's limit is clamped to the host's. Core exports `payloadTooLargeError` so every path answers with the same wording.
