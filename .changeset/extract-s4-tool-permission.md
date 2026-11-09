---
"@jini-ai/agent-plugins": minor
---

`registerAgentPluginExecutableTools` (`@jini-ai/agent-plugins/connect/executable`) now takes a required `toolPermission: string` in its required object and authorizes every plugin tool with that permission instead of the fixed `admin.assistant.use` name. **Breaking for direct registrar callers:** a caller that builds `AgentPluginExecutableRegistrationRequired` itself must now pass the permission its own RBAC grants (there is no default). A host that wants the previous behaviour passes `toolPermission: 'admin.assistant.use'`; the refusal shape on denial is unchanged.
