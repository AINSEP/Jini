---
"@jini-ai/core": minor
---

The shared engine now masks the value of an `x-auth-token` header and of a `Token`, `ApiKey` or `Digest` credential in an `Authorization` / `Proxy-Authorization` header, and a bare `Basic` or `Token` credential of 16+ characters with a digit. A scheme word with no value after it (`Authorization: Bearer`, as written in documentation) is no longer masked.
