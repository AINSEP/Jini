import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { createCleanupPreviewStore } from '../preview-store.js';

it('a token cannot be replayed or used by another admin', () => {
  let now = 0;
  const randomToken = ({ bytes }: { bytes: number }) => { expect(bytes).toBe(16); return randomBytes(bytes).toString('hex'); };
  const store = createCleanupPreviewStore({ randomToken, mono: () => now }, { ttlMs: 100 });
  const required = { principal: 'alice', kind: 'chats', scope: 'ws' };
  const first = store.put({ ...required, payload: { ids: ['a', 'b'] } }, {});
  expect(store.take({ ...required, principal: 'bob', token: first.token }, {})).toBeNull();
  expect(store.take({ ...required, scope: 'other', token: first.token }, {})).toBeNull();
  const taken = store.take({ ...required, token: first.token }, {});
  expect(taken?.payload).toEqual({ ids: ['a', 'b'] });
  expect(store.take({ ...required, token: first.token }, {})).toBeNull();
  now = 90;
  const rotated = store.put({ ...required, payload: { ids: ['b'], deadline: taken!.deadline } }, {});
  expect(rotated.deadline).toBe(100);
  now = 100;
  expect(store.take({ ...required, token: rotated.token }, {})).toBeNull();
  const next = store.put({ ...required, payload: { ids: ['c'] } }, {});
  const replacement = store.put({ ...required, payload: { ids: ['d'] } }, {});
  expect(store.take({ ...required, token: next.token }, {})).toBeNull();
  expect(store.take({ ...required, token: replacement.token }, {})?.payload).toEqual({ ids: ['d'] });
});
