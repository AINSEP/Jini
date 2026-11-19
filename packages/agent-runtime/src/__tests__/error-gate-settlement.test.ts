import { expect, it, vi } from 'vitest';
import { setStoredOAuthToken } from '../providers/oauth-tokens.js';

const filesystem = vi.hoisted(() => ({
  chmod: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(), rename: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => filesystem);

it('returns the failed token write to its caller and runs the queued write once', async () => {
  const failure = new Error('token write refused');
  let reject!: (error: unknown) => void;
  filesystem.writeFile.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const args = { dataDir: '/token-settlement', fileName: 'tokens.json', token: { accessToken: 'fixture', tokenType: 'Bearer', savedAt: 0 } };
  const first = setStoredOAuthToken(args);
  const rejected = expect(first).rejects.toBe(failure);
  const second = setStoredOAuthToken(args);
  await vi.waitFor(() => expect(filesystem.writeFile).toHaveBeenCalledTimes(1));
  reject(failure);
  await rejected;
  await expect(second).resolves.toBeUndefined();
  expect(filesystem.writeFile).toHaveBeenCalledTimes(2);
  expect(filesystem.rename).toHaveBeenCalledTimes(1);
});
