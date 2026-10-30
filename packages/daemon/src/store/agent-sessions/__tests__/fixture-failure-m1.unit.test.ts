import { afterEach, expect, it, vi } from 'vitest';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import { pgliteFixture } from './fixtures.js';

vi.mock('@jini-ai/db/kernel/pglite', () => ({ openPgliteKernel: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });

it('closes the newly opened fixture kernel when schema creation fails and preserves the cause', async () => {
  const failure = new Error('schema refused');
  const execute = vi.fn(async () => { throw failure; });
  const close = vi.fn(async () => {});
  vi.mocked(openPgliteKernel).mockReturnValue({ execute, close } as never);
  await expect(pgliteFixture()).rejects.toBe(failure);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.mocked(openPgliteKernel)).toHaveBeenCalledTimes(1);
});
