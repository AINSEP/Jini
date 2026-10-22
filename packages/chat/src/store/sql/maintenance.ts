/** Privileged bounded retention, kept separate from every request-scoped store. */
// A sweep crosses owners; attaching it to ChatStore would require the unscoped escape hatch
// owner-bound construction deliberately removes. Give this factory only to maintenance callers.
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatDatabase } from './tables.js';
import type { ChatHistoryMaintenance } from '../ports.js';
import { ChatStoreError } from '../errors.js';
import { atStoreBoundary, runChatQuery } from './boundary.js';

/** Delete at most 500 expired parents; the host schema/foreign-key policy supplies cascades. */
export function createSqlChatMaintenance<DB extends ChatDatabase>({ kernel }: { kernel: StorageKernel<DB> }): ChatHistoryMaintenance {
  return {
    sweepExpired: ({ now }, { limit = 500 } = {}) => atStoreBoundary({ operation: async () => {
      // Drain a backlog in chunks: an unbounded delete can hold the write lock until concurrent
      // inserts exhaust their busy timeout. NULL expiry remains structurally outside the sweep.
      if (!Number.isFinite(now) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new ChatStoreError({ code: 'invalid-input' });
      const result = await runChatQuery({ kernel: kernel, body: db => db.deleteFrom('ai_chats').where('id', 'in',
          db.selectFrom('ai_chats').select('id').where('expires_at', 'is not', null).where('expires_at', '<=', now).limit(limit),
        ).executeTakeFirst() });
      return Number(result.numDeletedRows);
    } }),
  };
}
