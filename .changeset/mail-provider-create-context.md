---
"@jini-ai/platform": minor
---

Add optional `now` and opaque per-install `settings` to `MailAdapterCreateContext`, inherited by
`MailProviderModule.create`. Export `createMailAdapterContext` from `@jini-ai/platform/mail` so hosts
can supply a live real clock and fresh empty settings at composition time while legacy direct
create calls remain compatible. Provider modules retain ownership of settings validation.
