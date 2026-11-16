import { expect, it, vi } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';

it('logs an idle-pool failure as its class and redacted message, without connecting to a database', async () => {
  let emit!: (error: Error) => void;
  class Pool {
    options = {};
    on(_event: 'error', listener: (error: Error) => void) { emit = listener; }
    async connect(): Promise<never> { throw new Error('this test must never connect'); }
    async end() {}
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => value => value } }, connectionString: 'postgres://unused' });
  try {
    emit(new Error('boom api_key=SECRETSECRETSECRETSECRET'));
    expect(warn).toHaveBeenCalledWith('[postgres] idle pool connection dropped:', 'Error: boom api_key=[REDACTED:labeled_secret]');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRETSECRET|postgres-idle-error-redaction/);
  } finally { warn.mockRestore(); await kernel.close(); }
});
