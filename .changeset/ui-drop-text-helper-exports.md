---
"@jini-ai/ui": minor
"@jini-ai/db": minor
---

Remove the `@jini-ai/ui/i18n` subpath and the helpers that moved to `@jini-ai/core/text` from the `@jini-ai/ui` root and `@jini-ai/ui/panel-kit` (`createDictionaryTranslator`, `interpolate`, `splitOnPlaceholders`, `pickPlural`, `localeEntry`, `formatTimestamp`, `formatRelativeMinutesAgo`, `resolveActiveTabId`, `isAbortError`, and the `Translate`, `DictionaryTranslator`, `LocaleDictionary` types). Import them from `@jini-ai/core/text`. Remove the unread `describeError` port from `DatabaseTransferToolPorts` in `@jini-ai/db`.
