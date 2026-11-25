---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

Add the universal `@jini-ai/core/contracts/site/media-upload-limits` entry with the single 50 MiB `MEDIA_MAX_UPLOAD_BYTES` media policy value. `@jini-ai/cms/media` re-exports it, and the CMS document limit and keep-as-is video threshold now bind to it instead of repeating the literal. The standalone CMS 10 MiB default and the separate video intake ceiling are unchanged.
