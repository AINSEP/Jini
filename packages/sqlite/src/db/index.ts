/**
 * @module @injini/sqlite/db
 * Neutral SQLite persistence for the daemon: connection lifecycle + schema migration + per-table
 * CRUD, ported from the upstream daemon's decomposed `db/` capability-barrel. Only the generic engine
 * tables (projects, conversations, messages, agent_sessions) are ported; OD-product tables
 * (preview_comments, tabs, deployments, routines, templates) are intentionally excluded.
 */
export { openDatabase, closeDatabase } from './connection/index.js';
export {
  listConversations,
  getConversation,
  normalizeConversationSessionMode,
  insertConversation,
  updateConversation,
  deleteConversation,
} from './conversations/index.js';
export {
  listMessages,
  upsertMessage,
  getMessageTelemetryFinalizationState,
  appendMessageStatusEvent,
  appendMessageAgentEvent,
  deleteMessage,
} from './messages/index.js';
export {
  listProjects,
  listLatestProjectRunStatuses,
  listLatestConversationRunStatuses,
  listFirstConversationRunStatuses,
  listLatestRunStatuses,
  listProjectsAwaitingInput,
  listConversationsAwaitingInput,
  getProject,
  insertProject,
  updateProject,
  deleteProject,
} from './projects/index.js';
export {
  getAgentSession,
  upsertAgentSession,
  getAgentSessionRecord,
  latestCompletedAssistantMessageId,
  updateAgentSessionStableHash,
  clearAgentSession,
} from './agent-sessions/index.js';
export type { SqliteDb, DbRow, JsonObject, ChatSessionMode } from './core/index.js';
export { parseJsonOrUndef, row, rows } from './core/index.js';
export { migrate } from './schema/index.js';
export type { ToolCatalogEntry, ToolCatalogSearchHit } from './tool-catalog/index.js';
export { ensureToolCatalogTables, reseedToolCatalog, getToolCatalogEntry, searchToolCatalog } from './tool-catalog/index.js';
