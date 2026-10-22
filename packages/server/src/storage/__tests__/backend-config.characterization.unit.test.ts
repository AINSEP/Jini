import { afterEach, expect, it, vi } from 'vitest';
import { resolveSqliteBackendConfig, SqliteBackendConfigError } from '../backend-config.js';

const postgresEnv: Record<string, string | undefined> = {
  JINI_SQLITE_BACKEND: '  POSTGRES  ',
  JINI_PG_HOST: 'db.internal', JINI_PG_DATABASE: 'jini', JINI_PG_USER: 'app',
};

afterEach(() => { vi.unstubAllEnvs(); });

it.each([undefined, '', '   ', '  SQLITE  '])('selects SQLite for backend %j without reading Postgres fields', backend => {
  const env = { JINI_SQLITE_BACKEND: backend, get JINI_PG_HOST(): string { throw new Error('must not read'); } };
  expect(resolveSqliteBackendConfig({}, { env })).toEqual({ kind: 'sqlite' });
});

it('normalizes unknown backend names in the typed error message', () => {
  const resolve = () => resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: '  MYSQL  ' } });
  expect(resolve).toThrow(SqliteBackendConfigError);
  expect(resolve).toThrow("unknown JINI_SQLITE_BACKEND value 'mysql'. Accepted: 'sqlite' (default), 'postgres'.");
});

it.each([
  [undefined, 5432], ['', 5432], ['invalid', 5432], ['0', 5432], ['6543', 6543],
] as const)('resolves Postgres port %j to %i', (input, port) => {
  expect(resolveSqliteBackendConfig({}, { env: { ...postgresEnv, JINI_PG_PORT: input } })).toEqual({
    kind: 'postgres', postgres: { host: 'db.internal', port, database: 'jini', user: 'app', sslMode: 'require' },
  });
});

it.each([['-1', -1], ['70000', 70000], ['123junk', 123], ['3.5', 3]] as const)(
  'accepts invalid Postgres port %j as %i (reported, not fixed)', (input, port) => {
    expect(resolveSqliteBackendConfig({}, { env: { ...postgresEnv, JINI_PG_PORT: input } }).postgres?.port).toBe(port);
  },
);

it.each([
  [undefined, 'require'], ['', 'require'], ['require', 'require'],
  ['disable', 'disable'], ['verify-full', 'verify-full'], ['VERIFY-FULL', 'require'], ['unknown', 'require'],
] as const)('resolves SSL mode %j to %s without normalization', (input, sslMode) => {
  expect(resolveSqliteBackendConfig({}, { env: { ...postgresEnv, JINI_PG_SSL_MODE: input } }).postgres?.sslMode).toBe(sslMode);
});

it.each(['JINI_PG_HOST', 'JINI_PG_DATABASE', 'JINI_PG_USER'])(
  'rejects missing and empty %s with the original typed validation error', field => {
    for (const value of [undefined, '']) {
      const resolve = () => resolveSqliteBackendConfig({}, { env: { ...postgresEnv, [field]: value } });
      expect(resolve).toThrow(SqliteBackendConfigError);
      expect(resolve).toThrow(
        'JINI_SQLITE_BACKEND=postgres requires JINI_PG_HOST, JINI_PG_DATABASE, JINI_PG_USER. ' +
        'JINI_PG_PORT defaults to 5432; JINI_PG_SSL_MODE defaults to "require".',
      );
    }
  },
);

it('uses the process environment when the optional env port is absent', () => {
  vi.stubEnv('JINI_SQLITE_BACKEND', 'postgres');
  vi.stubEnv('JINI_PG_HOST', 'process-host');
  vi.stubEnv('JINI_PG_PORT', '6432');
  vi.stubEnv('JINI_PG_DATABASE', 'process-db');
  vi.stubEnv('JINI_PG_USER', 'process-user');
  vi.stubEnv('JINI_PG_SSL_MODE', 'verify-full');
  expect(resolveSqliteBackendConfig({})).toEqual({ kind: 'postgres', postgres: {
    host: 'process-host', port: 6432, database: 'process-db', user: 'process-user', sslMode: 'verify-full',
  } });
});
