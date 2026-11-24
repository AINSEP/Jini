---
"@jini-ai/core": minor
"@jini-ai/chat": minor
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
"@jini-ai/agentic": minor
"@jini-ai/mcp": minor
"@jini-ai/registry": minor
---

Assistant runtime and site chat extraction (w4-assistant): host-neutral pieces of the assistant moved in with every host value injected.

- core: `httpOriginOf`, read-card schema/selector helpers (`tool-read-cards`), settings `readEffectiveFailClosed` / `readUserLayerObject`.
- chat: `./browser/embed-send-bridge` (`installEmbedSendBridge`, `createEmbedSendAgentControl`); browser session store gains `overCapReads` and `onFailure`; chat principals, `createChatMaintenanceForKernel` and `createLazyChatRunLedger` in `store/runtime`.
- daemon: `./daemon-call-context`, `./byok-meta-tool-result`, `./store/agent-sessions/kernel`; `daemon/http` gains lost-frontend bindings, run active-context store, surface-callback request decisions, A2UI action decisions and `createPrefixToolFamilyPort`; root gains page-approval context; `adoptAndEnsureDaemonSecret`.
- agent-runtime: `./cli-probe-cache`, `./custom-instructions`, `./model-catalog/live-discovery`, `resolveProviderProtocol`, `patchNativePermissionLayer`.
- agentic: `page.navigate` refusal rewrap, published-page input gates, A2UI exchange session helpers.
- mcp: ask-choice custom answer helpers, `createMcpRosterChangeBus`, `createFederationRuntime`.
- registry: `createRefreshingToolCatalogQuery`, declared tool keyword helpers.
