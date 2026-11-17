---
"@jini-ai/analytics": patch
"@jini-ai/capability-providers": patch
"@jini-ai/cli": patch
"@jini-ai/commerce": patch
"@jini-ai/http-kit": patch
"@jini-ai/integrations": patch
"@jini-ai/registry": patch
"@jini-ai/ui": patch
"@jini-ai/user-management": patch
"@jini-ai/admin": patch
"@jini-ai/chat": patch
"@jini-ai/cms": patch
"@jini-ai/plugins": patch
---

No longer declare Jini packages their production code does not import. Removed: analytics (agent-runtime peer), capability-providers (platform peer), cli and http-kit (platform dependency), commerce (agentic and ui peers), integrations (db peer), registry (db peer), ui (platform dependency), user-management (agentic peer). Moved to `devDependencies` because only tests import them: admin (agentic, ui-kit peers), chat (agentic dependency), cms (platform peer), plugins (db peer), registry (platform dependency), ui (agentic, ui-kit dependencies). A consumer that relied on the transitive install of one of these must declare it itself.
