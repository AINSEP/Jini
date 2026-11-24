---
"@jini-ai/agent-plugins": major
"@jini-ai/cms": major
"@jini-ai/db": minor
"@jini-ai/devops": minor
"@jini-ai/plugins": minor
"@jini-ai/search": minor
"@jini-ai/user-management": minor
---

Website feature extraction, lane w5-webfeat.

Breaking (`@jini-ai/agent-plugins`, `@jini-ai/cms`): `carryCloudflareActivation` is renamed `carryPluginRenameActivation`; `loadAnalyticsProviders`, `loadCredentialSchemeRegistry` and `loadMediaProviderRegistry` take one `required` object (context plus collaborators) and `_optional = {}` instead of `(ctx, required)`; `deriveAvailableName`/`deriveDuplicateName` require an injected `CopyNamingPolicy` (suffix + exhaustion wording).

New host-neutral modules, every host value injected: `@jini-ai/agent-plugins/site/bundled-id-upgrade` and lifecycle `mcpServerTrustClassifier`; `@jini-ai/cms` `forms/destinations/key-store`, `media/site/public-urls`, `publish/content/{backstop-refusal,peers,apply-retire}`, `settings/site/site-title-preservation`; `@jini-ai/db/transfer` ORM-neutral schema catalog (injected introspection port); `@jini-ai/devops/backup/site/{share-refusal,archive-media,static-export-selection}`; `@jini-ai/plugins/runtime/sdk-resolver` (required `sdkModulePath`); `@jini-ai/search/site/index-state-store` and `@jini-ai/user-management/server/sql` (kysely optional type-only peer, kernel + tables injected).
