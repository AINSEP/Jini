import { expect, it, vi } from 'vitest';
import { InMemoryFormSubmissionRepo } from '../forms/repo.memory.js';

it('returns the transaction error and runs its queued successor once', async () => {
  const repo = new InMemoryFormSubmissionRepo();
  const failure = new Error('form transaction refused');
  let reject!: (error: unknown) => void;
  const first = repo.transaction(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
  const rejected = expect(first).rejects.toBe(failure);
  const work = vi.fn(async () => 'successor');
  const second = repo.transaction(work);
  await Promise.resolve();
  expect(work).not.toHaveBeenCalled();
  reject(failure);
  await rejected;
  await expect(second).resolves.toBe('successor');
  expect(work).toHaveBeenCalledTimes(1);
});
