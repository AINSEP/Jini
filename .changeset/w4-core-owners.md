---
"@jini-ai/core": minor
"@jini-ai/daemon": major
---

Neutral Core owners for definitions that blocked wave-3 extraction lanes (w4-core-owners):

- `@jini-ai/core/tool-metadata/post` and `@jini-ai/core/tool-metadata/image-transform`: the post and image-transform tool declarations, moved verbatim from the host.
- `@jini-ai/core/tool-access-change`: `NotifyToolAccessChanged` and `ToolAccessLoweringError` (`code: 'TOOL_ACCESS_STOP_FAILED'`), moved from the host.
- `@jini-ai/core/contracts/site/daemon-http`: now owns the `AttachmentStore` port and `AttachmentClaim`, so a domain package can type a run-attachment lookup without depending on the daemon. **Breaking for `@jini-ai/daemon/http`:** it no longer exports these two types; import them from the Core subpath. Runtime values (`AttachmentRejectedError`, `isUnchangedAttachment`, `createDiskAttachmentStore`) stay in the daemon.
- `@jini-ai/core/optimistic-concurrency`: adds the admin `SaveConflict` shape next to `VERSION_CONFLICT_CODE`.
- `@jini-ai/core/contracts/hosted-mcp`: adds the external-MCP admission report wire types (`AdminToolRefusalReason`, `AdminRemoteToolSurfaceEntry`, `AdminFederatedAdmissionEntry`, `AdminExternalMcpAdmissionsSnapshot`, and their parts), moved from the host admin.
