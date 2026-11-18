---
"@jini-ai/core": patch
---

The shared engine masks the whole value of a custom auth header (`x-auth-token`, `x-api-key`, ...) when it carries a scheme word (`Token`, `ApiKey`, `Bearer`, `Basic`, `Digest`), not only the scheme word, and masks a `Proxy-Authorization` value that has no scheme word.
