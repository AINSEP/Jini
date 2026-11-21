import { expect, test } from 'vitest';
import { createAgUiPauseStore } from '@jini-ai/chat/core/ag-ui';
import { createSurfaceExchangeStore, classifyConfirmationAnswer } from '../surface-exchanges.js';

// Moved from chat's ag-ui/__tests__/interrupts.test.ts (jm7-a AG3-J) by combine-8: it needs both the
// chat pause store and this package's exchange store, and only daemon may depend on chat.
const handoff = { owner: 'owner', threadId: 'thread', runId: 'original', interruptId: 'approval', state: { cursor: 7 }, scopeKey: 'guest', abandonAtMs: 100 };

test('exchange expiry denies the tool while the retained continuation remains claimable', async () => {
  let now = 0;
  const callbacks: (() => void)[] = [];
  const exchanges = createSurfaceExchangeStore({ clock: { nowMs: () => now }, idGenerator: { newId: () => 'exchange' },
    scheduler: { schedule: ({ callback }) => { callbacks.push(callback); return () => {}; } }, defaultChannel: 'mcp-ui' }, { idleTtlMs: 10, maxLifetimeMs: 20 });
  const exchange = exchanges.open({ binding: { toolId: 'tool', principalId: 'owner' }, emit: async () => {} });
  const store = createAgUiPauseStore({ caps: { global: 1, perScope: 1 }, nowMs: () => now });
  store.park(handoff);
  const answer = exchange.receive({});
  now = 10;
  callbacks[1]!();
  const expired = await answer;
  expect(expired).toEqual({ status: 'expired' });
  expect(classifyConfirmationAnswer({ answer: expired })).toEqual({ confirmed: false, reason: 'expired' });
  expect(store.claim(handoff)?.state).toEqual({ cursor: 7 });
});
