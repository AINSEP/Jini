---
"@jini-ai/core": minor
"@jini-ai/cms": minor
"@jini-ai/search": minor
---

Settings registrars and readers in `@jini-ai/cms/settings/site/*` and `@jini-ai/search/site/settings` now take `ensureSettingDefinitions` / `getEffective` through their existing deps (new `EnsureSettingDefinitionsPort` / `GetEffectivePort` in `@jini-ai/core/settings`). Breaking for callers of those subpaths: pass the core functions in the deps object.
