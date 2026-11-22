import { afterEach, vi } from 'vitest';

// `node:child_process` is mocked with a *passthrough* default: unless a test
// installs `mockState.spawnImpl` / `mockState.execFileImpl`, calls go straight
// to the real implementation. This keeps the happy-path tests exercising real
// subprocesses (matching this package's convention in shell.test.ts and
// terminal.test.ts) while still allowing targeted control of hard-to-trigger
// branches (a spawned child reporting no pid, Windows-only snapshot parsing,
// command failures) without spawning fake OSes.
type ExecFileCallback = (error: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void;

// A plain object, not `vi.hoisted`: vitest refuses to export a hoisted
// variable, and this module is imported before the module under test, so the
// state exists before the mock factory below reads it.
export const mockState = {
  execFileImpl: null as ((command: string, args: string[], options: unknown, callback: ExecFileCallback) => void) | null,
  spawnImpl: null as ((command: string, args: string[], options: unknown) => unknown) | null,
};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (command: string, args: string[], options: unknown, callback: ExecFileCallback) => {
      if (mockState.execFileImpl) return mockState.execFileImpl(command, args, options, callback);
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(command, args, options, callback);
    },
    spawn: (command: string, args: string[], options: unknown) => {
      if (mockState.spawnImpl) return mockState.spawnImpl(command, args, options);
      return (actual.spawn as unknown as (...a: unknown[]) => unknown)(command, args, options);
    },
  };
});

afterEach(() => {
  mockState.execFileImpl = null;
  mockState.spawnImpl = null;
});

export async function withPlatformAsync<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const previous = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', { value: previous });
  }
}

