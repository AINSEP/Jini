/** Native compatibility adapter, loaded only when a host did not inject its own SQLite opener. */
import { loadOptionalPeer } from '@jini-ai/core/optional-peer';
import type { SqliteSyncOpener } from '@jini-ai/db/sqlite';
export async function loadMediaSqliteOpener(_required: Record<string, never>, _optional: Record<string, never> = {}): Promise<SqliteSyncOpener> {
  const { default: Database } = await loadOptionalPeer({ feature: 'SQLite storage', dependency: 'better-sqlite3', load: () => import('better-sqlite3') });
  return (file, options) => new Database(file, options);
}
