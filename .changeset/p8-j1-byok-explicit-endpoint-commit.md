---
"@jini-ai/ui": patch
---

BYOK model discovery now sends the key only to an endpoint the operator explicitly committed (Base URL blur, Enter outside IME composition, a preset's own default, or Test connection) instead of any URL that stayed unchanged for 600 ms. Approval is per provider, protocol and trimmed URL; a carried Custom draft or a restored saved non-default URL stays unapproved. Test connection skips both probes for an invalid Base URL. `ByokProviderForm` gains an optional `onBaseUrlCommit` prop.
