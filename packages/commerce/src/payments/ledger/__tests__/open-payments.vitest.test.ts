import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { openMemorySqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { memoryPaymentsLedger } from '../repo.memory.js';
import { migrateCommercePayments, sqlPaymentsLedger } from '../sql.js';
import { payment } from './ledger-contract.js';
for (const adapter of ['memory', 'sqlite']) test(`${adapter}: open payment lookup is bounded, scoped and deterministic`, async () => {
  const kernel = adapter === 'sqlite' ? openMemorySqliteKernel<unknown>({ open: (file, options) => new Database(file, options) }) : null;
  try {
    if (kernel) await migrateCommercePayments({ kernel });
    const ledger = kernel ? sqlPaymentsLedger({ kernel }) : memoryPaymentsLedger();
    await ledger.transaction({ fn: async tx => {
      expect(await tx.hasOpenPayment({ workspaceId: 'ws-1' })).toBe(false);
      await tx.insertPayment({ payment: payment({ id: 'later', idempotencyKey: 'later', intentStatus: 'requires_action', createdAt: 30 }) });
      await tx.insertPayment({ payment: payment({ id: 'first', idempotencyKey: 'first', intentStatus: 'unknown', createdAt: 10 }) });
      await tx.insertPayment({ payment: payment({ id: 'done', idempotencyKey: 'done', intentStatus: 'succeeded', createdAt: 1 }) });
      expect(await tx.hasOpenPayment({ workspaceId: 'ws-1' })).toBe(true);
      expect((await tx.findOpenPayment({ workspaceId: 'ws-1' }))?.id).toBe('first');
      expect(await tx.findOpenPayment({ workspaceId: 'foreign' })).toBeNull();
      expect(await tx.findOpenPayment({ workspaceId: 'ws-1' }, { mode: 'test' })).toBeNull();
    } });
  } finally { await kernel?.close(); }
});
