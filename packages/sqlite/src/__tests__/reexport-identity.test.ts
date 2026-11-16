import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import * as eventLog from '@jini-ai/daemon/store/event-log/sqlite';
import * as dbSqlite from '@jini-ai/db/sqlite';
import * as storage from '@jini-ai/core/contracts/storage';
import * as chatSqlite from '@jini-ai/chat/store/sqlite';
import * as toolCatalog from '@jini-ai/registry/tool-catalog/sqlite';
import * as legacy from '@jini-ai/chat/store/legacy/sqlite';
import * as agentSessions from '@jini-ai/daemon/store/agent-sessions/sqlite';

const origins: Array<[string, Record<string, unknown>, string[]]> = [
  ['daemon event-log', eventLog, ['createSqliteEventLog', 'DEFAULT_MAX_ENTRIES_PER_RUN']],
  ['db sqlite', dbSqlite, ['inspectSqliteDatabase', 'verifySqliteIntegrity']],
  ['core storage', storage, ['parseJsonOrUndef', 'row', 'rows']],
  ['chat sqlite', chatSqlite, ['CHAT_HISTORY_DDL', 'createChatHistoryMaintenance', 'createChatHistoryStore', 'ensureChatHistoryTables']],
  ['registry tool-catalog', toolCatalog, ['ensureToolCatalogTables', 'getToolCatalogEntry', 'reseedToolCatalog', 'searchToolCatalog']],
  ['chat legacy sqlite', legacy, ['appendMessageAgentEvent', 'appendMessageStatusEvent', 'deleteConversation', 'deleteMessage', 'getConversation', 'getMessageTelemetryFinalizationState', 'insertConversation', 'listConversations', 'listMessages', 'normalizeConversationSessionMode', 'updateConversation', 'upsertMessage']],
  ['daemon agent-sessions', agentSessions, ['clearAgentSession', 'getAgentSession', 'getAgentSessionRecord', 'latestCompletedAssistantMessageId', 'updateAgentSessionStableHash', 'upsertAgentSession']],
];

describe('@jini-ai/sqlite re-exports are the origin bindings, not copies', () => {
  it.each(origins)('%s', (_label, module, names) => {
    for (const name of names) {
      expect(name in barrel, `${name} missing from barrel`).toBe(true);
      expect((barrel as Record<string, unknown>)[name]).toBe(module[name]);
    }
  });

  it('covers every runtime export of the barrel exactly once', () => {
    const covered = origins.flatMap(([, , names]) => names).sort();
    expect(covered).toEqual(Object.keys(barrel).sort());
  });

  it('keeps the shared storage helpers behaving: parseJsonOrUndef tolerates bad JSON', () => {
    expect(barrel.parseJsonOrUndef('{"a":[1]}')).toEqual({ a: [1] });
    expect(barrel.parseJsonOrUndef('not json')).toBeUndefined();
    expect(barrel.parseJsonOrUndef(null)).toBeUndefined();
  });
});
