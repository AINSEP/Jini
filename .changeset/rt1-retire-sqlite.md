---
"@jini-ai/db": major
"@jini-ai/artifacts": patch
"@jini-ai/capability-providers": patch
"@jini-ai/chat": patch
"@jini-ai/daemon": patch
"@jini-ai/integrations": patch
"@jini-ai/protocol": patch
"@jini-ai/registry": patch
"@jini-ai/server": patch
---

`@jini-ai/sqlite` is removed (owner retire order, RT-1). It only re-exported names from their owners; import them from there: `@jini-ai/daemon/store/event-log/sqlite` (`createSqliteEventLog`, `DEFAULT_MAX_ENTRIES_PER_RUN`), `@jini-ai/daemon/store/agent-sessions/sqlite`, `@jini-ai/db/sqlite` (`inspectSqliteDatabase`, `verifySqliteIntegrity`), `@jini-ai/core/contracts/storage` (`SqliteDb`, `DbRow`, `row`, `rows`, `parseJsonOrUndef`), `@jini-ai/db/core` (`JsonObject`), `@jini-ai/chat/store/sqlite` (chat history), `@jini-ai/chat/store/legacy/sqlite` (conversations and messages) and `@jini-ai/registry/tool-catalog/sqlite` (tool-catalog runtime). The barrel's types come from their own owners: `ChatSessionMode` from `@jini-ai/chat/store/legacy`, and `ToolCatalogEntry` and `ToolCatalogSearchHit` from `@jini-ai/registry/tool-catalog`. The other packages only reword doc comments that named the old package.
