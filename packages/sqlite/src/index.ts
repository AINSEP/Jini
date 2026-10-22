/**
 * @deprecated Compatibility for the remaining 0.3.x storage names; prefer concern subpaths.
 * Durable event-log adapters live in daemon, inspection/driver primitives in db.
 * Backend selection, acquisition and project composition belong to the server shell;
 * importing this facade must not pull that higher-level assembly into storage consumers.
 * Inject host handles/openers. See docs/spec/api.spec.md for scope and migration targets.
 */
export { createSqliteEventLog, DEFAULT_MAX_ENTRIES_PER_RUN } from '@jini-ai/daemon/store/event-log/sqlite';
export type { SqliteEventLog, SqliteEventLogOptions } from '@jini-ai/daemon/store/event-log/sqlite';
export { inspectSqliteDatabase, verifySqliteIntegrity } from '@jini-ai/db/sqlite';
export type { DaemonDbStatusReport, DaemonDbTableInfo, DbIntegrityIssue, DbIntegrityIssueKind, DbIntegrityReport, SqliteDb, VerifyDbOptions } from '@jini-ai/db/sqlite';
export { parseJsonOrUndef, row, rows } from '@jini-ai/db/core';
export type { DbRow, JsonObject } from '@jini-ai/db/core';
export type { ChatSessionMode } from '@jini-ai/chat/store/legacy';
export { CHAT_HISTORY_DDL, createChatHistoryMaintenance, createChatHistoryStore, ensureChatHistoryTables } from '@jini-ai/chat/store/sqlite';
export type { ToolCatalogEntry, ToolCatalogSearchHit } from '@jini-ai/registry/tool-catalog';
export { ensureToolCatalogTables, getToolCatalogEntry, reseedToolCatalog, searchToolCatalog } from '@jini-ai/registry/tool-catalog/sqlite';
export { appendMessageAgentEvent, appendMessageStatusEvent, deleteConversation, deleteMessage, getConversation, getMessageTelemetryFinalizationState, insertConversation, listConversations, listMessages, normalizeConversationSessionMode, updateConversation, upsertMessage } from '@jini-ai/chat/store/legacy/sqlite';
export { clearAgentSession, getAgentSession, getAgentSessionRecord, latestCompletedAssistantMessageId, updateAgentSessionStableHash, upsertAgentSession } from '@jini-ai/daemon/store/agent-sessions/sqlite';
