---
"@jini-ai/integrations": minor
---

`@jini-ai/integrations/api-connections` no longer imports `@jini-ai/oauth` or `@jini-ai/platform`: hosts pass a required `oauth: ApiConnectionOAuthCapabilities` (real OAuth exports) to the API host, service deps and `createSignInHandoffs`, and a required `isVaultConflict` classifier to `createVaultOAuthTokenStore`; callback-field leaves come from `@jini-ai/core/oauth-callback-fields`.
