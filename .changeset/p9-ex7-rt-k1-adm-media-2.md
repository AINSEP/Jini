---
"@jini-ai/cms": patch
---

Add K1 route specs for the admin media where-used and import-url routes moved from the host: `@jini-ai/cms/admin-http/routes/media/{where-used,import-url}` (`mediaWhereUsedRoute`, `mediaImportUrlRoute`). Both keep their own 403 bodies through `authorizeMediaOrForbid`.
