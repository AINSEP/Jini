---
"@jini-ai/admin": minor
---

The Security module's media key Replace and Remove no longer read the whole provider map and PUT it back,
which the revision-guarded whole-map PUT now refuses with 409 `MEDIA_PROVIDERS_STALE`. Replace sends one
`PATCH /media/providers/:providerId` with only the typed `{ apiKey }`; Remove sends one `DELETE` on that
row (path-encoded id, no body). `SecurityTransportPort.request` now also accepts `method: 'PATCH'`, so a
host transport must forward it. The `mediaOrder` option and `MediaWriteOrder` type are deprecated and have
no effect; they stay so existing hosts keep compiling.

Hosts must let their `SecurityTransportPort` forward `PATCH` (now part of the port's method list); `mediaOrder` is deprecated and ignored.
