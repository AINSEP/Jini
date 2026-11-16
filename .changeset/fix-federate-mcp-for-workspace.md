---
"@jini-ai/agent-plugins": patch
---

`resolveAgentPluginMcpServers` calls `forWorkspace({ workspaceId })` and `AgentPluginLayout.forWorkspace` takes the object-args shape, fixing a `toLowerCase` TypeError on enable/connect.
