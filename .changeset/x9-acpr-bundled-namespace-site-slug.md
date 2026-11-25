---
"@jini-ai/core": patch
"@jini-ai/integrations": patch
"@jini-ai/cms": patch
---

Add `ClientNamespaceFor` to core, the universal `./api-connections/bundled-client-namespace` reader (manifest projection injected, allowlist checked before any read) to integrations, and `analyzeContentWithSiteSlug` (scorer bound to the renderer's `toSlug`) to `@jini-ai/cms/seo/content-analysis`.
