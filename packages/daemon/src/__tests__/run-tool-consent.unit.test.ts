import assert from 'node:assert/strict';
import { test } from 'vitest';
import { requestRunToolConsent, type RunToolConsentSnapshot } from '../run-tool-consent.js';

const snapshot = (): RunToolConsentSnapshot => ({ permissions: { enabled: true, capabilities: { userMcp: false, shell: true } }, revisionSeq: 3, allowed: true });

test('a consent click writes only the fixed selected-agent keys and addressed revision', async () => {
  const writes: unknown[] = [];
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => snapshot(), ask: async () => ({ confirmed: true }),
    allowSelected: async input => { writes.push(input); return true; } });
  assert.deepEqual(result, { status: 'allowed' });
  assert.deepEqual(writes, [{ agentId: 'agy', keys: ['userMcp'], expectedRevisionSeq: 3 }]);
});

for (const allowed of [false]) test('non-owner or host-locked authority never opens a card or writes', async () => {
  let calls = 0;
  assert.deepEqual(await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => ({ ...snapshot(), allowed, reason: 'host_locked' }),
    ask: async () => { calls++; return { confirmed: true }; }, allowSelected: async () => { calls++; return true; } }),
  { status: 'blocked', reason: 'host_locked' });
  assert.equal(calls, 0);
});

test('cancelled clicks have no effect', async () => {
  let writes = 0;
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => snapshot(), ask: async () => ({ confirmed: false }), allowSelected: async () => { writes++; return true; } });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(writes, 0);
});

test('a terminal run cannot commit after an approval click', async () => {
  let live = true; let writes = 0;
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => live,
    readFresh: async () => snapshot(), ask: async () => { live = false; return { confirmed: true }; },
    allowSelected: async () => { writes++; return true; } });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(writes, 0);
});

test('effective changes while the card is open replace it with a fresh card', async () => {
  let reads = 0; const cards: boolean[] = []; const writes: unknown[] = [];
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => ({ ...snapshot(), revisionSeq: ++reads === 1 ? 3 : 4 }),
    ask: async ({ stale }) => { cards.push(stale); return { confirmed: true }; },
    allowSelected: async input => { writes.push(input); return true; } });
  assert.deepEqual(result, { status: 'allowed' });
  assert.deepEqual(cards, [false, true]);
  assert.deepEqual(writes, [{ agentId: 'agy', keys: ['userMcp'], expectedRevisionSeq: 4 }]);
});

test('a CAS conflict re-asks and never treats the old click as authority for the new write', async () => {
  let calls = 0; const cards: boolean[] = [];
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => snapshot(), ask: async ({ stale }) => { cards.push(stale); return { confirmed: cards.length === 1 }; },
    allowSelected: async () => { calls++; return false; } });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(cards, [false, true]);
  assert.equal(calls, 1);
});

test('a revoked owner/host permission after the click refuses the write', async () => {
  let reads = 0;
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => ({ ...snapshot(), allowed: ++reads === 1 }), ask: async () => ({ confirmed: true }),
    allowSelected: async () => { throw new Error('must not write'); } });
  assert.deepEqual(result, { status: 'blocked' });
});

test('alternative clicks never grant the selected agent and forged choices are cancelled', async () => {
  for (const choice of ['other', 'forged']) {
    const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], alternatives: ['other'], isLive: () => true,
      readFresh: async () => snapshot(), ask: async () => ({ confirmed: true, choice }),
      allowSelected: async () => { throw new Error('must not write'); } });
    assert.deepEqual(result, choice === 'other' ? { status: 'alternative', agentId: 'other' } : { status: 'cancelled' });
  }
});

test('a terminal run cannot open a consent card', async () => {
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => false,
    readFresh: async () => snapshot(), ask: async () => { throw new Error('must not ask'); },
    allowSelected: async () => { throw new Error('must not write'); } });
  assert.deepEqual(result, { status: 'cancelled' });
});

test('mutating the stored snapshot while a card is open does not rewrite what was approved', async () => {
  const stored = snapshot(); let asks = 0; let writes = 0;
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => true,
    readFresh: async () => stored,
    ask: async () => { asks++; (stored.permissions.capabilities as Record<string, boolean>).userMcp = true; return { confirmed: asks === 1 }; },
    allowSelected: async () => { writes++; return true; } });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(asks, 2);
  assert.equal(writes, 0);
});

test('terminal completion during a fresh permission read still blocks the commit', async () => {
  let live = true; let reads = 0;
  const result = await requestRunToolConsent({ agentId: 'agy', keys: ['userMcp'], isLive: () => live,
    readFresh: async () => { if (++reads === 2) live = false; return snapshot(); },
    ask: async () => ({ confirmed: true }), allowSelected: async () => { throw new Error('must not write'); } });
  assert.deepEqual(result, { status: 'cancelled' });
});
