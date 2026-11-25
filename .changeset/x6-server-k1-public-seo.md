---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

Add the public SEO document routes (`sitemap.xml`, `robots.txt`, `llms.txt`, `feed.xml`) as server-neutral raw specs under `@jini-ai/cms/public-http/routes/site/*`, and an optional `servingOrigin` request fact on `RouteRequestFacts` so a route can format absolute URLs on the origin the host says it was served from.
