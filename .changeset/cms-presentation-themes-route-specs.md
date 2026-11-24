---
"@jini-ai/cms": patch
---

New admin route specs `@jini-ai/cms/admin-http/routes/presentation/{get,rescan-themes}` and `@jini-ai/cms/admin-http/routes/themes/{list,duplicate}` (K1): server-neutral `defineJsonRoute` specs; the host injects its theme registry reads, rescan, duplicate, preview capture policy and DTO mapping.
