---
"@jini-ai/db": patch
---

`@jini-ai/platform` is no longer an optional peer of `@jini-ai/db`: `secrets-vault` takes its credential contracts from `@jini-ai/core/contracts/vault`, so no db entry imports platform any more.
