---
"@jini-ai/cms": patch
---

Agent-plugins and external-MCP admin route ports, per review rv1123i. `agentPluginSetEnabledRoute`'s deps take a required `diagnose` sink that receives structured facts (`AgentPluginSetEnabledRefusalDiagnostic`: plugin id, host-fault refusal, cause message) in place of a pre-formatted `warn` line; the host owns the log label and wording. The id-free list and files specs document that their `entityType: ""` placeholder must be dropped by the host binding, because an empty resource type can match. The tool-approvals list and revoke routes each take their own required port (`listApprovals({ workspaceId })`, `revokeApproval({ workspaceId, serverId, toolName })`), replacing the shared `toolApprovalRepo` store dep. Rows are typed by Core's `ExternalMcpToolApprovalDto` and still projected to its four fields. Wire bodies and statuses are unchanged.
