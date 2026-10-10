import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { createChatHistoryStore, ensureChatHistoryTables, createSqliteChatStore } from '../sqlite/index.js';
import type { ChatDatabase } from '../sql/tables.js';
import { conversationUsage } from '../../core/turn-usage.js';
import { formatUsageCost } from '../../core/usage-format.js';
import { parseUsageEvent } from '../../core/run-events/entry.js';

const require = createRequire(new URL('../../../../db/package.json', import.meta.url));
const Database = require('better-sqlite3');
const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;

it('retains cumulative session snapshots through a real SQLite close/reopen and a later resumed turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-cost-reopen-'));
  const path = join(dir, 'chat.sqlite');
  let db = new Database(path);
  try {
    ensureChatHistoryTables({ db });
    const original = createChatHistoryStore({ db, scope });
    await original.create({ id: 'c' });
    for (const [id, cumulativeCostUsd] of [['a', 2.05], ['b', 2.5]] as const) {
      await original.appendMessage({ conversationId: 'c', message: { id, role: 'assistant', content: id, agentId: 'claude',
        events: [parseUsageEvent({ payload: { type: 'usage', cumulativeCostUsd, costSessionId: 's' } })] } });
    }
    const before = conversationUsage({ messages: await original.messages({ conversationId: 'c' }) });
    db.close();
    db = new Database(path);
    const reloaded = createSqliteChatStore({ kernel: sqliteKernel<ChatDatabase>(db), scope });
    const page = await reloaded.pageMessages({ conversationId: 'c' });
    expect(page.items.map(message => message.events)).toEqual([
      [{ kind: 'usage', cumulativeCostUsd: 2.05, costSessionId: 's' }],
      [{ kind: 'usage', cumulativeCostUsd: 2.5, costSessionId: 's' }],
    ]);
    expect(conversationUsage({ messages: page.items })).toEqual(before);
    await reloaded.appendMessage({ conversationId: 'c', message: { id: 'continued', role: 'assistant', agentId: 'claude', content: 'third',
      events: [parseUsageEvent({ payload: { type: 'usage', cumulativeCostUsd: 2.75, costSessionId: 's' } })] } });
    const usage = conversationUsage({ messages: (await reloaded.pageMessages({ conversationId: 'c' })).items }).get('continued')!;
    expect(formatUsageCost({ costUsd: usage.costUsd!, totalCostUsd: usage.totalCostUsd! })).toBe('$0.25 (Total: $2.75)');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
