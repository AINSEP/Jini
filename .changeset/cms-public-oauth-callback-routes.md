---
"@jini-ai/cms": patch
---

The public OAuth callbacks ship as server-neutral `ServerRoute` factories: `@jini-ai/cms/public-http/routes/api-connections/oauth-callback` (`apiConnectionOAuthCallbackRoute`) and `@jini-ai/cms/public-http/routes/external-mcp/oauth-callback` (`externalMcpOAuthCallbackRoute`), with the callback path and URL builder at `…/external-mcp/oauth-callback-url` and the closed failure vocabulary, renderer port and no-store HTML response at `…/oauth/callback-page`. The host injects its copy, cookie rules, error-class predicates, services, origin policy and logger. Wire bodies and statuses are unchanged.
