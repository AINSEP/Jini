Spec ID: SPEC-JINI-SQLITE-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:622b09096f2250d3d8d997c7724af032d1be46b90235ebf391051dfc0489d2ec
spec_mode: reverse_spec

# SQLite compatibility API contract

The sole entry `@jini-ai/sqlite` is a deprecated compatibility facade. Its barrel delegates to db, chat, daemon and registry; it has no root export for backend selection, acquisition, migrations, project CRUD or run projections. Those moved to server/storage, server/storage/legacy/sqlite and server/store/projects/sqlite. Imports allocate no database and select no native driver. New consumers should use the concern subpaths directly.

## Durable event log

`createSqliteEventLog({db: SqliteDb}, {maxEntriesPerRun = 2000, clock?: Clock} = {}): SqliteEventLog` borrows a synchronous handle and creates its dedicated schema. Only the object form is accepted. Clock is core Clock.nowMs(). DEFAULT_MAX_ENTRIES_PER_RUN, SqliteEventLog and SqliteEventLogOptions are exported. Owned acquisition is available as openSqliteEventLog from daemon/store/event-log/sqlite; that factory is not a facade export.

Methods: `append({runId,event,data}, {dedupeKey?} = {})`, `replay({runId,afterCursor})`, `listRunIds({})`, `drop({runId})`, `close({})`. Append returns EventLogEntry; replay returns ok/unknown-run/replay-gap. Invalid Number-converted cursors reject. Close never closes the borrowed handle. The previous declaration/runtime argument mismatch is resolved. [Canonical log contract](../../../daemon/docs/spec/api.spec.md).

## Database values and inspection

Runtime exports are `inspectSqliteDatabase({db,file})`, `verifySqliteIntegrity(options: VerifyDbOptions)` with quick still in its required options object, `parseJsonOrUndef(value)`, `row(value)` and `rows(values)`. The row helpers retain positional inputs. Types: DaemonDbStatusReport, DaemonDbTableInfo, DbIntegrityIssue, DbIntegrityIssueKind, DbIntegrityReport, SqliteDb, VerifyDbOptions, DbRow, JsonObject. JSON aliases are imported/re-exported by the db owner; no new facade wire model exists. [Canonical DB contract](../../../db/docs/spec/api.spec.md).

## Chat history and legacy rows

Runtime exports: CHAT_HISTORY_DDL, createChatHistoryMaintenance, createChatHistoryStore and ensureChatHistoryTables from chat/store/sqlite. Owner-scoped factories require host-owned kernels/owner tuples and expose the canonical chat methods; the facade adds no wrapper. ChatSessionMode is a type-only export from chat/store/legacy.

Legacy synchronous calls borrow db in object arguments: `listConversations({db,projectId})`, `getConversation({db,id})`, `insertConversation({db,c})`, `updateConversation({db,id,patch})`, `deleteConversation({db,id})`, `normalizeConversationSessionMode({value})`, `listMessages({db,conversationId})`, `upsertMessage({db,conversationId,m})`, `getMessageTelemetryFinalizationState({db,messageId})`, `appendMessageStatusEvent({db,messageId,event})`, `appendMessageAgentEvent({db,messageId,event})`, `deleteMessage({db,id})`. The current facade does not export their error constructors or LEGACY_CHAT_DDL. [Canonical chat declarations and limits](../../../chat/docs/spec/api.spec.md).

## Agent sessions

Runtime exports: `getAgentSession({db,conversationId,agentId})`, `getAgentSessionRecord({db,conversationId,agentId})`, `upsertAgentSession({db,input})` where input contains conversationId/agentId/sessionId plus nullable metadata, `latestCompletedAssistantMessageId({db,conversationId,excludeMessageId}, {resumableMessageId = null} = {})`, `updateAgentSessionStableHash({db,conversationId,agentId,stablePromptHash})`, `clearAgentSession({db,conversationId,agentId})`. They borrow a host handle; facade exports neither session DDL nor a connection owner. [Canonical daemon declarations](../../../daemon/docs/spec/api.spec.md).

## Tool discovery

Runtime exports: `ensureToolCatalogTables({db})`, `reseedToolCatalog({db,entries}, {now = Date.now()} = {})`, `getToolCatalogEntry({db,id})`, `searchToolCatalog({db,query}, {limit = 10} = {})`. Types ToolCatalogEntry/ToolCatalogSearchHit come from registry/tool-catalog. SQLite FTS5/JSON support is required, connection lifetime is host owned. [Canonical registry contract](../../../registry/docs/spec/api.spec.md).

```ts
import { createSqliteEventLog, ensureToolCatalogTables, searchToolCatalog } from '@jini-ai/sqlite';
const log = createSqliteEventLog({ db }, { clock });
await log.append({ runId: 'run-1', event: 'message', data: { text: 'hello' } }, { dedupeKey: 'producer-1' });
ensureToolCatalogTables({ db });
const hits = searchToolCatalog({ db, query: 'read item' });
await log.close({}); // host closes db after all borrowers finish
```

Evidence: current facade barrel and its owner source declarations; source inspection only.


## Current manifest boundary

The current `package.json` exposes `.`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
