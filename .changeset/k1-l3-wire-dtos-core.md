---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

Admin wire DTOs for media, seo (settings + sitemap; per-entry `SeoMeta` bodies deferred) and assistant are declared in Core (`contracts/site/cms-media`, `cms-seo`, `cms-assistant`); the cms serializers and route specs consume them without re-exporting. Route helpers (`mediaIdParam`, `seoEntryIdParam`, `assistantBody`, `readProbeRequestFields`, `toExecutionTabAgent`) take object arguments (rv1123e K1 migration).
