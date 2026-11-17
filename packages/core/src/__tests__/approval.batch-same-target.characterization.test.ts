import { expect, it } from 'vitest';
import { createPreparedBatchHandler } from '../approval.js';
import { fakePrepare, fakeVersionedStore, STALE_TEXT, toolContext } from './batch-chain-store-fake.js';

/** Characterizes today's behaviour: every item is pinned before the first one writes, so the second
 * item for the same file is refused by its own pin and the refusal ends the whole call. */
it('a prepared batch of three items on one file applies item 1, then throws item 2\'s error and never runs item 3', async () => {
  const store = fakeVersionedStore({ 'a.css': '' });
  const ran: string[] = [];
  const handler = createPreparedBatchHandler({
    prepare: fakePrepare({ store }),
    run: async ({ prepared }) => {
      ran.push(prepared.append);
      return store.write({ key: prepared.key, pinned: prepared.pinned, append: prepared.append });
    },
  });
  const ctx = toolContext({ input: { items: [
    { key: 'a.css', append: '1' }, { key: 'a.css', append: '2' }, { key: 'a.css', append: '3' },
  ] } });

  // Thrown, not returned: the caller gets no per-item account of what was applied.
  await expect(handler(ctx)).rejects.toThrow(new Error(STALE_TEXT));
  expect(ran).toEqual(['1', '2']);
  expect(store.bytes({ key: 'a.css' })).toBe('1');
});
