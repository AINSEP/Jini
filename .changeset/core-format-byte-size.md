---
"@jini-ai/core": minor
"@jini-ai/admin": minor
---

`@jini-ai/core/text` exports `formatByteSize({ bytes }, { locale?, megabyteLabel? })`, the one B/KB/MB/GB display label. `@jini-ai/admin/media` no longer exports its own `formatByteSize`; import it from `@jini-ai/core/text`.
