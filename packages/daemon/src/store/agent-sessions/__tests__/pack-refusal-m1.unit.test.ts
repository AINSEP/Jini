import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fixture, pack } from './packed-fixture.js';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFileSync: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });

it('refuses an empty npm pack result before attempting to extract an unspecified archive', () => {
  const dir = fixture({ prefix: 'pack-refusal-m1-' });
  try {
    vi.mocked(execFileSync).mockReturnValue('[]');
    // 88e8f9f routed pack() through the shared npm 11/12 reader, which owns this refusal message.
    expect(() => pack({ dir, name: 'daemon' })).toThrow('npm pack --json: expected exactly one packed package, got 0');
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileSync).mock.calls[0]?.[0]).toBe('npm');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
