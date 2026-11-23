---
"@jini-ai/core": patch
---

Add seven host-neutral site contracts, each (except `nav`) an additive copy of declarations its owning package keeps until the paired cutover: `./contracts/site/agent-runtime` (`DetectedAgent`, `AgentDiagnostic` and its vocabulary), `./contracts/site/http-kit-settings` (`SettingsErrorMapping`), `./contracts/site/nav` (`AdminNavGroup`, `AdminNavItem`, `AdminNavEntry`, copied from `@jini-ai/admin/core` so a host nav model can name the shape without the admin shell), `./contracts/site/agentic` (`AgentNavigationScreen`, `ResolvedPageEntity`, `PageEntityLookup`), `./contracts/site/events-outbox` (`OutboxDrainer`, `OutboxRetryPolicyResolver` and the retry-policy shapes), `./contracts/site/agent-plugins-manifest` (`AgentPluginExport` and `AdminSurfaceActionSchema`) and `./contracts/site/user-management-server` (`LoginProvider`, `AuthServiceDeps` and their small closure).
