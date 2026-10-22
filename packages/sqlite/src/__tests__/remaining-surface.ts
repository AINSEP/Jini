/** The immutable old snapshot stays intact; server composition now has its own public owner. */
import { readFileSync } from 'node:fs';
export const serverOwnedNames = new Set(["resolveSqliteBackendConfig", "SqliteBackendConfigError", "SqliteBackendConfig", "SqliteBackendKind", "closeDatabase", "migrate", "openDatabase", "deleteProject", "getProject", "insertProject", "listConversationsAwaitingInput", "listFirstConversationRunStatuses", "listLatestConversationRunStatuses", "listLatestProjectRunStatuses", "listLatestRunStatuses", "listProjects", "listProjectsAwaitingInput", "updateProject"]);
const old: { name: string; runtime: boolean }[] = JSON.parse(readFileSync(new URL('./old-surface.json', import.meta.url), 'utf8'));
export const remainingSurface = old.filter(entry => !serverOwnedNames.has(entry.name));
