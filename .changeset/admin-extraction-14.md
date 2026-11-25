---
"@jini-ai/integrations": minor
---

Add four explicit browser leaves under `./react/site-key/`: `SiteKeyTab` (SiteKeyTab, SiteKeyGenerateAction, SiteKeyTabProps), `SiteKeyRecoveryCard` (SiteKeyRecoveryCard), `hooks/use-site-key.hooks` (useSiteKey, classifySiteKeyGenerateError, SiteKeyController, SiteKeyGenerateFailure), and `hooks/use-site-key-recovery.hooks` (useSiteKeyRecovery, START_FRESH_CONFIRMATION, isSiteKeyLocked, siteKeyLockedNote, SiteKeyRecoveryController, SiteKeyRecoveryPort). Host key policy and error classification remain injected.
