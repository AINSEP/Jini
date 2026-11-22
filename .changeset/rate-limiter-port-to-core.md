---
"@jini-ai/core": minor
"@jini-ai/http-kit": minor
"@jini-ai/cms": patch
---

The `RateLimiter` interface and `RateLimitResult` move to `@jini-ai/core/contracts/server`, so a package that only checks a request budget no longer depends on the HTTP toolkit. http-kit's `createRateLimiter` still returns that interface and keeps every behaviour; http-kit no longer exports the two types. cms's comment ingress takes the type from core and drops `@jini-ai/http-kit` from its optional peers.
