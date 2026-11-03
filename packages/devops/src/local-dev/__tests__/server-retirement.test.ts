import { expect, test } from 'vitest';
import { createDevServerRetirement } from '../server-retirement.js';

test('an eviction cannot stop a server with active or accepted background work', async () => {
  const guard = createDevServerRetirement({ hasWork: async () => false });
  const release = guard.begin({});
  expect(await guard.retire({})).toBe(false);
  release({ background: true });
  expect(await guard.retire({})).toBe(false);
});

test('canceling a pending eviction invalidates its late idle answer', async () => {
  let finish!: (busy: boolean) => void;
  const guard = createDevServerRetirement({ hasWork: () => new Promise<boolean>(resolve => { finish = resolve; }) });
  const retiring = guard.retire({});
  expect(guard.accepting({})).toBe(false);
  guard.cancel({});
  finish(false);
  expect(await retiring).toBe(false);
  expect(guard.accepting({})).toBe(true);
});

test('an idle server rejects new work once its eviction has been accepted', async () => {
  const guard = createDevServerRetirement({ hasWork: async () => false });
  expect(await guard.retire({})).toBe(true);
  expect(() => guard.begin({})).toThrow('intake is fenced');
});
