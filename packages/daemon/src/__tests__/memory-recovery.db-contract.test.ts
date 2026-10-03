import { expect, it } from 'vitest';
import { openSqliteConnection } from '@jini-ai/db/sqlite';

// Recovery policy belongs to the host. The connection helper invokes it even for ephemeral paths;
// a host with file-only recovery must deliberately make its hook a no-op for those paths.
it('calls supplied recovery before opening an ephemeral connection', () => {
  const calls: string[] = [];
  const connection = { pragma(value: string) { calls.push(`pragma:${value}`); } };
  const result = openSqliteConnection({ filePath: ':memory:', recover(file) { calls.push(`recover:${file}`); }, open(file) { calls.push(`open:${file}`); return connection as never; }, pragmas: [] });
  expect(result).toBe(connection);
  expect(calls).toEqual(['recover::memory:', 'open::memory:']);
});
