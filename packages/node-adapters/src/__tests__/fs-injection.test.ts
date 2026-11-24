import { describe, expect, it, vi } from 'vitest';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import { createAtomicWriterPort, createFileLockPort } from '../fs.js';

/** The fs builders bind only what the host hands them: each port member is the injected function itself,
 * so a builder that reached for a module-level implementation instead would fail these assertions. */
describe('fs port builders use the injected platform functions', () => {
  it('createFileLockPort calls the injected withFileLock with the port arguments unchanged', async () => {
    const withFileLock = vi.fn(async ({ run }: { lockPath: string; run: (lock: never) => unknown }) => run(undefined as never)) as unknown as FileLockPort['withFileLock'] & ReturnType<typeof vi.fn>;
    const port: FileLockPort = createFileLockPort({ withFileLock });
    const run = vi.fn(() => 'ran');
    await expect(port.withFileLock({ lockPath: '/fake/x.lock', run }, { timeoutMs: 5 })).resolves.toBe('ran');
    expect(withFileLock).toHaveBeenCalledWith({ lockPath: '/fake/x.lock', run }, { timeoutMs: 5 });
    expect(port.withFileLock).toBe(withFileLock);
  });

  it('createAtomicWriterPort maps each injected function to its port member', async () => {
    const writeFileAtomicAsync = vi.fn(async () => undefined);
    const writeJsonFileAtomicAsync = vi.fn(async () => undefined);
    const backupOriginalOnce = vi.fn(async () => undefined);
    const port: AtomicFileWriterPort = createAtomicWriterPort({ writeFileAtomicAsync, writeJsonFileAtomicAsync, backupOriginalOnce });
    await port.writeText({ filePath: '/fake/a.txt', content: 'one' });
    await port.writeJson({ filePath: '/fake/a.json', data: { a: 1 } }, { trailingNewline: true });
    await port.backupOriginalOnce({ filePath: '/fake/a.json' });
    expect(writeFileAtomicAsync).toHaveBeenCalledExactlyOnceWith({ filePath: '/fake/a.txt', content: 'one' });
    expect(writeJsonFileAtomicAsync).toHaveBeenCalledExactlyOnceWith({ filePath: '/fake/a.json', data: { a: 1 } }, { trailingNewline: true });
    expect(backupOriginalOnce).toHaveBeenCalledExactlyOnceWith({ filePath: '/fake/a.json' });
  });
});
