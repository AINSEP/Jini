---
"@jini-ai/cms": patch
---

Add the SEO admin route specs (`./admin-http/routes/seo/{deps,get-entry,get-entry-analyze,post-sitemap-regenerate,put-entry}`) as server-neutral `defineJsonRoute` specs with their own small deps types; hosts mount them through their http-kit ports.
