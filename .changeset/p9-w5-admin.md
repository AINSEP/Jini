---
"@jini-ai/admin": major
"@jini-ai/desktop-host": major
"@jini-ai/cms": minor
"@jini-ai/core": patch
"@jini-ai/chat": patch
"@jini-ai/devops": patch
"@jini-ai/integrations": patch
---

Wave-5 admin moves (w5-admin), breaking for direct callers of the changed admin and desktop-host subpaths:

- Core owns shared wire contracts: `contracts/site/cms-trash`, `contracts/site/cms-integrations`, plugin-file envelopes in `contracts/site/cms-plugins`, external-MCP admin shapes in `contracts/site/cms-external-mcp`, and `contracts/speech-transcription` (desktop-host no longer exports `SpeechBridge`, `TranscriptionAvailability`, `TranscriptionResult`; import them from core). Admin's duplicate plugin/trash types (`AdminPlugin*`, `AdminTrash*`, `screens/trash/api/trash-api.types`) are removed in favour of the core DTOs.
- Admin gains request-injected API clients and their types/ports for security, source-control, deployment, integrations and providers; access-token rows/categories/providers and custom-credential forms; per-screen dictionary factories (`create<X>Dictionary({ commonDictionary, productName })`) with `core/bind-dictionary-names`; external-MCP drift and tool-picker rules; Trash rules; `IntegrationsRedirect`, `useProviders`, `usePluginProviderSettings`, `AgentPlugins.hooks`, `useThemePages`, `useSecurityPermissions({ port, permission, useFetchQuery })`, `useChatDisplayPreferences`, `useAssistantChats({ port, client, lastConversation })`, `openMcpUiLink`, `useExportPassword`, `posts/view-tabs`. Custom hooks arrive as REQUIRED fields/props; `isLiveEditor` takes `{ editor }`; `useRevealedKeyCopy` takes required clipboard and scheduler ports; dock menu classes are `jini-row-menu-*`.
- cms gains a browser surface `react/media` (remote image import dialog; kit, hook, error formatter and media port injected).
- chat gains `react/features/voice-input/space-hold-rules`; devops gains `local-dev/dev-proxy-upstream`; integrations gains `CONFIGURABLE_MEDIA_PROVIDER_CATALOG`.
