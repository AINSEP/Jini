---
"@jini-ai/core": patch
"@jini-ai/cms": minor
---

Plugins and recovery wire DTOs now live in Core (`contracts/site/cms-plugins`, `contracts/site/cms-recovery`); the cms route modules no longer export `AdminPluginDto`, `AdminPluginListEnvelope`, `PluginSetEnabledEnvelope` or the `RecoveryStatus*` types. `pluginIdParam({ params })` and `onPluginEnabled/onPluginDisabled({ pluginId })` take named objects; `resolveDegradedBanner` returns `AdminDegradedBannerDto | null`. Wire output is unchanged.
