// @vitest-environment node
import { expect, it } from 'vitest';
import { FetchQueryCache } from '../cache.js';

it('uses host clock/scheduler ports and replacement supersedes an in-flight read', async () => {
  let now = 100;
  const timers = new Map<unknown, () => void>();
  let id = 0;
  const cache = new FetchQueryCache({}, {
    clock: { nowMs: () => now },
    scheduler: {
      schedule: ({ callback }) => { const handle = ++id; timers.set(handle, callback); return handle; },
      cancel: ({ handle }) => { timers.delete(handle); },
    },
  });
  const entry = cache.entry({ key: ['rows'] }, { staleTime: 50 });
  let settle!: (value: string) => void;
  const pending = cache.load({ entry, fetch: () => new Promise<string>(resolve => { settle = resolve; }), staleTime: 50 });
  await Promise.resolve();
  cache.replace({ entry, data: 'written' });
  settle('older read');
  expect(await pending).toBe('written');
  expect(entry.state.data).toBe('written');
  now = 149;
  expect(cache.fresh({ entry, staleTime: 50 })).toBe(true);
  now = 150;
  expect(cache.fresh({ entry, staleTime: 50 })).toBe(false);
  expect(timers.size).toBe(1);
  cache.dispose();
  expect(timers.size).toBe(0);
});
