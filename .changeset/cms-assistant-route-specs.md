---
"@jini-ai/cms": patch
---

Add the admin assistant route specs (`./admin-http/routes/assistant/*`): settings, visitor tools, site/execution credentials (shared guards in `assistant/shared`) and the execution probes detect-agents, list-models, test-agent, test-connection (`assistant/execution-shared`). Host policy, stores, error tables and every runtime/network probe are injected deps.
