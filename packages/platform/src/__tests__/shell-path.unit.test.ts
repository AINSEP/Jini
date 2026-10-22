import { execFile } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { execCommandViaLoginShell } from '../shell.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_command: string, _args: string[], _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, 'ready', '');
  }),
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('uses a non-login shell and preserves the process PATH even when a custom env is supplied', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('SHELL', '/custom/shell');
  vi.stubEnv('PATH', '/host/shims:/usr/bin');
  const env = { PATH: '/custom/env' };
  await expect(execCommandViaLoginShell('inspect', ['plain'], { env })).resolves.toEqual({
    code: undefined, error: null, ok: true, stderr: '', stdout: 'ready',
  });
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(execFile).toHaveBeenCalledWith('/custom/shell', [
    '-c', "export PATH='/host/shims:/usr/bin'; 'inspect' 'plain'",
  ], { timeout: 120_000, maxBuffer: 1024 * 1024, env }, expect.any(Function));
});
