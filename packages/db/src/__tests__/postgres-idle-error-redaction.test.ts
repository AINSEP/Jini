import { expect, it, vi } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';

it('redacts idle-pool failures without connecting to a database', async () => {
  let emit!: (error: Error) => void;
  class Pool {
    options = {};
    on(_event: 'error', listener: (error: Error) => void) { emit = listener; }
    async connect(): Promise<never> { throw new Error('this test must never connect'); }
    async end() {}
  }
  const secret = 'ghp_' + 's'.repeat(36);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => value => value } }, connectionString: 'postgres://unused' });
  try {
    emit(new Error(`connection dropped ${secret}`));
    expect(warn).toHaveBeenCalledWith('[postgres] idle pool connection dropped:', expect.stringContaining('Error: connection dropped [REDACTED:github_token]'));
    expect(String(warn.mock.calls[0]?.[1])).not.toContain(secret);
  } finally { warn.mockRestore(); await kernel.close(); }
});
