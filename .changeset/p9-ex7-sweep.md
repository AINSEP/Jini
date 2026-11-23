---
"@jini-ai/cms": patch
---

Move the host's admin-language discovery tool: `./settings/site/ui-locales-tool` (`buildUiLocalesRegistrations`, `uiLocalesAgentToolCatalog`, `uiLocalesDerivedRisk`, `UiLocalesToolDeps`, `UiLocaleOption`), with the offered locales injected through the tool's deps and host tool metadata left for the host to bind with `withToolMetadata`.
