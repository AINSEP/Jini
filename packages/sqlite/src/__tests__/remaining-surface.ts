/** The immutable old snapshot stays intact; server composition now has its own public owner. */
import { readFileSync } from 'node:fs';
export const serverOwnedNames = new Set(["resolveSqliteBackendConfig", "SqliteBackendConfigError", "SqliteBackendConfig", "SqliteBackendKind", "closeDatabase", "migrate", "openDatabase", "deleteProject", "getProject", "insertProject", "listConversationsAwaitingInput", "listFirstConversationRunStatuses", "listLatestConversationRunStatuses", "listLatestProjectRunStatuses", "listLatestRunStatuses", "listProjects", "listProjectsAwaitingInput", "updateProject",
  // Chat-owned `{ db }` wrappers, removed with no forwarder (C-CHAT-DEPS CH1): chat no longer imports db at runtime.
  // The kernel-taking pair `createSqliteChatStore` / `createSqliteChatMaintenance` in `@jini-ai/chat/store/sqlite` replaces them.
  "createChatHistoryMaintenance", "createChatHistoryStore"]);
const old: { name: string; runtime: boolean }[] = JSON.parse(readFileSync(new URL('./old-surface.json', import.meta.url), 'utf8'));
export const remainingSurface = old.filter(entry => !serverOwnedNames.has(entry.name));
