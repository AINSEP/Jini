import type { SqliteDb } from '@jini-ai/db/sqlite';

/** The host owns the connection and its lifetime; registry never opens a default database. */
export type RegistryDatabasePort = Pick<SqliteDb, 'prepare' | 'exec' | 'transaction'>;
