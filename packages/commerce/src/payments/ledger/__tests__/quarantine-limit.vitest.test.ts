import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { openMemorySqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { memoryPaymentsLedger } from '../repo.memory.js';
import { migrateCommercePayments, sqlPaymentsLedger } from '../sql.js';
import { payment } from './ledger-contract.js';

for (const adapter of ['memory', 'sqlite']) test(`${adapter}: attention quarantine reads are bounded and oldest first`, async () => {
  const kernel = adapter === 'sqlite' ? openMemorySqliteKernel<unknown>({ open: (file, options) => new Database(file, options) }) : null;
  try {
    if (kernel) await migrateCommercePayments({ kernel });
    const ledger = kernel ? sqlPaymentsLedger({ kernel }) : memoryPaymentsLedger();
    await ledger.transaction({ fn: async tx => {
      await tx.insertPayment({ payment: payment() });
      for (let index = 0; index < 4; index++) await tx.insertQuarantine({ entry: { id: `quarantine-${index}`,
        workspaceId: 'ws-1', mode: 'live', paymentId: 'pay-1', subject: 'order-projection', reason: 'blocked', evidenceJson: '{}', createdAt: index } });
      await tx.resolveQuarantine({ id: 'quarantine-0', resolvedAt: 100 });
      expect((await tx.listQuarantine({ workspaceId: 'ws-1', mode: 'live' }, { unresolvedOnly: true, limit: 2 })).map(row => row.id))
        .toEqual(['quarantine-1', 'quarantine-2']);
      expect(await tx.listQuarantine({ workspaceId: 'ws-1', mode: 'live' }, { limit: 0 })).toEqual([]);
    } });
  } finally { await kernel?.close(); }
});
