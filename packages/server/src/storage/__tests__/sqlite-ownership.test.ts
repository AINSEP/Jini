import { expect, it } from 'vitest';
import { resolveSqliteBackendConfig, SqliteBackendConfigError, type SqliteBackendConfig } from '../index.js';
import { openDatabase } from '../legacy/sqlite.js';

// PARITY: backend-config assertions formerly lived in the deprecated sqlite barrel suite.
it('owns backend configuration without opening a driver', () => {
  const config: SqliteBackendConfig = resolveSqliteBackendConfig({}, { env: {} });
  expect(config).toEqual({ kind: 'sqlite' });
  expect(() => resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'invalid' } }))
    .toThrow(SqliteBackendConfigError);
});

// PARITY: the packed sqlite test's missing-opener assertion belongs to server acquisition.
it('refuses a JavaScript caller without an opener before acquisition', () => {
  expect(() => Reflect.apply(openDatabase, undefined, [{ projectRoot: '/unused', open: undefined }]))
    .toThrow('openDatabase: inject options.open');
});
