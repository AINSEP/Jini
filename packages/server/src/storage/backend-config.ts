/**
 * @module backend-config
 *
 * Resolves which SQL backend a host daemon should use from environment
 * variables. v1 ships local SQLite via an injected `better-sqlite3` opener (the event-log adapter
 * now belongs to the daemon's storage subpath);
 * a `postgres` selection is recorded so a future adapter can read it, but
 * `resolveSqliteBackendConfig` never opens a connection itself — it only
 * pins the parameter surface (host/port/database/user/sslMode) so a
 * follow-up package can land the adapter without re-litigating the env-var
 * contract.
 */

export type SqliteBackendKind = 'sqlite' | 'postgres';

export interface SqliteBackendConfig {
  kind: SqliteBackendKind;
  /** Resolution metadata a future Postgres adapter will read. */
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
    /**
     * Password / connection string are looked up at runtime from the
     * caller's own secret manager; this layer never reads them through env.
     */
    sslMode?: 'disable' | 'require' | 'verify-full';
  };
}

export class SqliteBackendConfigError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = 'SqliteBackendConfigError';
  }
}

/**
 * Reads `JINI_SQLITE_BACKEND` (`'sqlite'` default, or `'postgres'`) and, for
 * `postgres`, `JINI_PG_HOST`/`JINI_PG_PORT`/`JINI_PG_DATABASE`/`JINI_PG_USER`/
 * `JINI_PG_SSL_MODE` from the given env map (defaults to `process.env`).
 *
 * @param required - No required configuration values; pass an empty argument object.
 * @param optional.env - Environment map to read from. Defaults to `process.env`.
 * @returns The resolved backend config.
 * @throws {SqliteBackendConfigError} When `kind` is unrecognized, or `postgres`
 *   is selected without the required host/database/user.
 */
export function resolveSqliteBackendConfig(
  required: Record<string, never>,
  optional: { env?: Record<string, string | undefined> } = {},
): SqliteBackendConfig {
  void required;
  const e = optional.env ?? process.env;
  const kind = (e.JINI_SQLITE_BACKEND ?? 'sqlite').trim().toLowerCase();
  if (kind === 'postgres') {
    const host = e.JINI_PG_HOST ?? '';
    const portStr = e.JINI_PG_PORT ?? '5432';
    const database = e.JINI_PG_DATABASE ?? '';
    const user = e.JINI_PG_USER ?? '';
    const sslMode =
      e.JINI_PG_SSL_MODE === 'disable' || e.JINI_PG_SSL_MODE === 'verify-full' ? e.JINI_PG_SSL_MODE : 'require';
    if (!host || !database || !user) {
      throw new SqliteBackendConfigError({ message:
        'JINI_SQLITE_BACKEND=postgres requires JINI_PG_HOST, JINI_PG_DATABASE, JINI_PG_USER. ' +
          'JINI_PG_PORT defaults to 5432; JINI_PG_SSL_MODE defaults to "require".',
      });
    }
    return {
      kind: 'postgres',
      postgres: {
        host,
        port: Number.parseInt(portStr, 10) || 5432,
        database,
        user,
        sslMode,
      },
    };
  }
  if (kind !== 'sqlite' && kind !== '') {
    throw new SqliteBackendConfigError({ message: `unknown JINI_SQLITE_BACKEND value '${kind}'. Accepted: 'sqlite' (default), 'postgres'.` });
  }
  return { kind: 'sqlite' };
}
