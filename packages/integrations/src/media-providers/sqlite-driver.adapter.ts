/** Native compatibility adapter, loaded only when a host did not inject its own SQLite opener. */
import type { SqliteSyncOpener } from '@jini-ai/db/sqlite';
export async function loadMediaSqliteOpener(_required: Record<string, never>, _optional: Record<string, never> = {}): Promise<SqliteSyncOpener> {
  const { default: Database } = await import('better-sqlite3');
  return (file, options) => new Database(file, options);
}
