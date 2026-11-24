---
"@jini-ai/cms": patch
---

New admin route specs `@jini-ai/cms/admin-http/routes/posts/autosave` (`postAutosaveGetRoute`, `postAutosaveDeleteRoute`, K1): the read and clear halves of the standing-draft autosave; the host injects its id-or-slug lookup, not-found predicate and autosave store calls.
