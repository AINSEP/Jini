---
"@jini-ai/core": patch
---

Add leaf subpaths for the w3 pages/members extraction (no barrel; import each leaf directly):

- `@jini-ai/core/tool-metadata/members`
- `@jini-ai/core/tool-metadata/newsletter`
- `@jini-ai/core/tool-metadata/server-logs`

Also exports `ServerLogFilters` and `ServerLogsResult` from `@jini-ai/core/contracts/site/platform-server-logs`.
