import { expect, test } from 'vitest';
import { memoryPaymentsLedger } from '../../../payments/ledger/repo.memory.js';
import { payment } from '../../../payments/ledger/__tests__/ledger-contract.js';
import { readCommerceDrain } from '../../merchant-drain.js';
const original = { providerId: 'stripe', accountId: 'acct-1', mode: 'live' as const, publicOrigin: 'https://shop.example' };
test('abandoned sessions release mode changes but keep an account transition sharing the webhook endpoint blocked', async () => {
  const ledger = memoryPaymentsLedger();
  await ledger.transaction({ fn: tx => tx.insertPayment({ payment: payment({ intentStatus: 'requires_action' }) }) });
  expect(await readCommerceDrain({ ledger, workspaceId: 'ws-1' }, { configured: { ...original, mode: 'test' } })).toBeNull();
  expect(await readCommerceDrain({ ledger, workspaceId: 'ws-1' }, { configured: original })).toBeNull();
  expect(await readCommerceDrain({ ledger, workspaceId: 'ws-1' }, { configured: null })).toMatchObject({ provider_account_id: 'acct-1' });
  expect(await readCommerceDrain({ ledger, workspaceId: 'ws-1' }, { configured: { ...original, accountId: 'acct-other' } })).toMatchObject({ provider_account_id: 'acct-1', mode: 'live' });
});
test.each([
  { ...original, accountId: 'acct-other', mode: 'test' as const },
  { ...original, providerId: 'other-provider', mode: 'test' as const },
])('an open session retains its original merchant when changing account or provider across modes: %j', async configured => {
  const ledger = memoryPaymentsLedger();
  await ledger.transaction({ fn: tx => tx.insertPayment({ payment: payment({ intentStatus: 'requires_action' }) }) });
  expect(await readCommerceDrain({ ledger, workspaceId: 'ws-1' }, { configured }))
    .toMatchObject({ provider_id: 'stripe', provider_account_id: 'acct-1', mode: 'live' });
});
