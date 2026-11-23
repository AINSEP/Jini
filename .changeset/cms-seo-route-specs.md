---
"@jini-ai/cms": patch
---

Add the admin SEO route specs (`./admin-http/routes/seo/{get-entry,get-entry-analyze,put-entry,get-settings,put-settings,post-sitemap-regenerate}`): server-neutral `defineJsonRoute` specs, each with its own deps type; the host injects its SEO readiness gate, settings ledger, sitemap service and the write chokepoint's authorizer.
