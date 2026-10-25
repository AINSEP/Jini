---
"@jini-ai/plugins": patch
"@jini-ai/provider-plugins": patch
---

Add admitted server-provider factory contributions and generation-scoped resource disposal to the
existing plugin host. Introduce one self-contained provider artifact distribution with a tiny
fixture, integrity maps, bundled license texts, and build-on-pack support.
Pending initialization settles on retirement or a configurable `initializeTimeoutMs`, so a
hung factory cannot block boot or shutdown; shutdown also awaits in-flight direct lease disposal.
