---
"@jini-ai/sqlite": minor
"@jini-ai/db": minor
---

`@jini-ai/sqlite` no longer exports `createChatHistoryStore` or `createChatHistoryMaintenance`: chat stopped importing db at runtime, and the wrappers are not kept as forwarders. Open the kernel and call `createSqliteChatStore({ kernel: sqliteKernel(db), scope, clock })` / `createSqliteChatMaintenance({ kernel })` from `@jini-ai/chat/store/sqlite`. `@jini-ai/db` gains a test-only `./testing` entry (`openMemorySqliteKernel`, `openFileSqliteKernel`, `openPgliteTestKernel`, `openPgliteSocketTestKernel`, `openPostgresTestKernel`).
