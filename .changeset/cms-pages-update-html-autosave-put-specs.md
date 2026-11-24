---
"@jini-ai/cms": patch
---

New admin route spec `@jini-ai/cms/admin-http/routes/pages/update-html` and `postAutosavePutRoute` in `@jini-ai/cms/admin-http/routes/posts/autosave` (K1). Neither declares `maxBodyBytes`: a host whose 413 copy differs from the kit's keeps its own body-size binding in the same registration.
