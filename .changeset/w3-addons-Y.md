---
"@jini-ai/mcp": patch
"@jini-ai/platform": patch
"@jini-ai/admin": patch
---

MCP: `createServerAdmissionsReader` takes the host's `reportReadFailure` reporter instead of a log formatter (Jini no longer writes the console); `createExternalMcpProbe`'s host gains `reauthResponseText` for the stored-reauth 409 copy, and `ExternalMcpProbeReauthError` no longer carries `message`. Platform: `startMailRetention` no longer falls back to `console.warn`; a failed pass is reported only through the host's `onError`. Admin: the Email screen dictionary is split across two files (no behaviour change).
