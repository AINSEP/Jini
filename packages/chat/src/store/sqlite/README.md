# store/sqlite

SQLite-backed `ChatStore` / `ChatHistoryMaintenance` over a `StorageKernel`.

## Wiring

Why the host injects the kernel: see `ADS-memory/reports/jini-port/extraction-plan.md` (K5, XC-2).

**Ports the host injects**
- `createSqliteChatStore` / `createSqliteChatMaintenance`: a ready `StorageKernel` (`kernel`).
- `createChatHistoryStore` / `createChatHistoryMaintenance` (raw-handle wrappers): the handle `db` and
  `sqliteKernel: OpenSqliteChatKernel<Source>`, the kernel factory the host takes from `@jini-ai/db`.

**Provides** the two stores above plus `ensureChatHistoryTables` / `CHAT_HISTORY_DDL`.

```ts
import Database from 'better-sqlite3';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { createChatHistoryStore, ensureChatHistoryTables } from '@jini-ai/chat/store/sqlite';

const db = new Database(file);
ensureChatHistoryTables({ db });
const store = createChatHistoryStore({ db, sqliteKernel, scope, clock: { nowMs: () => Date.now() } });
```

**Must never import** `@jini-ai/db` (or any driver) at runtime; types come from `@jini-ai/core/contracts/storage`.
