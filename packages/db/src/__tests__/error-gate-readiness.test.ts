import { expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { openPgliteKernel } from '../kernel/pglite/driver.js';

it('observes rejected readiness, preserves it for awaiters and still closes the client', async () => {
  const failure = new Error('schema preparation refused');
  let prepared!: () => void;
  const reached = new Promise<void>(resolve => { prepared = resolve; });
  let client: PGlite | undefined;
  const kernel = openPgliteKernel({ PGlite }, { prepare: async opened => {
    client = opened;
    prepared();
    throw failure;
  } });
  await reached;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await expect(kernel.ready).rejects.toBe(failure);
  await expect(kernel.run(async () => 'unreachable')).rejects.toBe(failure);
  const close = vi.spyOn(client!, 'close');
  await expect(kernel.close()).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledTimes(1);
});
