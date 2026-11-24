---
"@jini-ai/cms": patch
---

New admin route specs `@jini-ai/cms/admin-http/routes/pages/{list,get-by-id}` (K1): server-neutral `defineJsonRoute` specs with their own deps types; the host injects its page lookup, DTO mapping, not-found predicate and plugin-export catalog.
