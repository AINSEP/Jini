import { afterEach, expect, it, vi } from 'vitest';
import { runtimeFixture, type RuntimeFixture } from '../../runtime/__tests__/runtime-fixture.js';
import { createSqlChatStore } from '../store.js';
import { createChatBulkDeletion } from '../bulk-deletion.js';

let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });
const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
async function setup() {
  f = runtimeFixture();
  let now = 1;
  const store = createSqlChatStore({ kernel: f.kernel, scope, clock: { nowMs: () => now } });
  const open = new Set<string>();
  const bulk = createChatBulkDeletion({ kernel: f.kernel, scope, now: () => now, openConversations: async () => open }, {});
  await store.create({ id: 'old', title: 'Old' });
  return { store, bulk, open, setNow: (value: number) => { now = value; } };
}
it('pinned after preview is kept', async () => {
  const { store, bulk } = await setup();
  const preview = await bulk.preview({ before: 10 }, {});
  await store.setPinned({ id: 'old', pinned: true }, {});
  expect(await bulk.apply({ ids: preview.ids, before: 10 }, {})).toMatchObject({ deleted: [], kept: [{ id: 'old', reason: 'pinned' }] });
  expect(await store.get({ id: 'old' })).not.toBeNull();
});
it('run started during cleanup is kept', async () => {
  const { bulk, store } = await setup();
  const preview = await bulk.preview({ before: 10 }, {});
  const lock = f.kernel.lockKey.bind(f.kernel);
  vi.spyOn(f.kernel, 'lockKey').mockImplementation(async key => {
    await lock(key);
    if (key === 'chat-slot:old') f.sql("INSERT INTO ai_chat_messages(id,conversation_id,role,content,run_status,position,created_at) VALUES('run','old','assistant','','running',0,1)");
  });
  expect(await bulk.apply({ ids: preview.ids, before: 10 }, {})).toMatchObject({ deleted: [], kept: [{ id: 'old', reason: 'active' }] });
  expect(await store.get({ id: 'old' })).not.toBeNull();
});
it('never crosses owners', async () => {
  const { bulk } = await setup();
  const other = createSqlChatStore({ kernel: f.kernel, scope: { ...scope, ownerId: 'bob' }, clock: { nowMs: () => 1 } });
  await other.create({ id: 'foreign' });
  expect((await bulk.preview({ before: 10 }, {})).ids).toEqual(['old']);
  expect((await bulk.apply({ ids: ['foreign'] }, {})).deleted).toEqual([]);
  expect(await other.get({ id: 'foreign' })).not.toBeNull();
});
it('chat that became old after preview is not deleted', async () => {
  const { store, bulk, setNow } = await setup();
  setNow(20); await store.create({ id: 'later' });
  const preview = await bulk.preview({ before: 10 }, {});
  f.sql("UPDATE ai_chats SET updated_at = 1 WHERE id = 'later'");
  expect((await bulk.apply({ ids: preview.ids, before: 10 }, {})).deleted).toEqual(['old']);
  expect(await store.get({ id: 'later' })).not.toBeNull();
});
it('batches ≤ 500', async () => {
  const { bulk, store } = await setup();
  for (let n = 0; n < 500; n++) await store.create({ id: `c${n}` });
  await expect(bulk.apply({ ids: Array.from({ length: 501 }, (_, n) => `c${n}`) }, {})).rejects.toThrow();
  const lock = f.kernel.lockKey.bind(f.kernel);
  let perTransaction = 0;
  vi.spyOn(f.kernel, 'lockKey').mockImplementation(async key => { await lock(key); expect(++perTransaction).toBeLessThanOrEqual(50); });
  const transaction = f.kernel.transaction.bind(f.kernel);
  vi.spyOn(f.kernel, 'transaction').mockImplementation(run => transaction(async () => { perTransaction = 0; return run(); }));
  expect((await bulk.apply({ ids: Array.from({ length: 500 }, (_, n) => `c${n}`) }, {})).deleted).toHaveLength(500);
});
it("pinning keeps the chat's place", async () => {
  const { store, setNow } = await setup();
  setNow(2); await store.create({ id: 'new' });
  setNow(100); await store.setPinned({ id: 'old', pinned: true }, {});
  expect((await store.list()).map(({ id, updatedAt }) => ({ id, updatedAt }))).toEqual([{ id: 'new', updatedAt: 2 }, { id: 'old', updatedAt: 1 }]);
  await store.updateConversation({ id: 'old', title: 'Manual', pinned: false }, {});
  await store.updateConversation({ id: 'old', title: 'Generated', pinned: true }, { source: 'generated' });
  expect(await store.get({ id: 'old' })).toMatchObject({ title: 'Manual', pinned: true });
});
it('bulk delete of an active chat keeps it and names it', async () => {
  const { bulk, open } = await setup(); open.add('old');
  expect(await bulk.apply({ ids: ['old'] }, {})).toMatchObject({ kept: [{ id: 'old', title: 'Old', reason: 'open' }], deleted: [] });
});
