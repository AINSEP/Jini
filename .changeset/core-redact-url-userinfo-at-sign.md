---
"@jini-ai/core": patch
---

URL userinfo is now masked up to the last `@` of the authority, so a connection-URL password that contains `@` is masked whole instead of leaving its tail beside the host.
