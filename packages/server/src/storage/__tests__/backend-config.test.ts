import { describe, expect, it } from 'vitest';
import { SqliteBackendConfigError, resolveSqliteBackendConfig } from '../backend-config.js';

describe('resolveSqliteBackendConfig', () => {
  it('defaults to sqlite when JINI_SQLITE_BACKEND is unset', () => {
    expect(resolveSqliteBackendConfig({}, { env: {} })).toEqual({ kind: 'sqlite' });
  });

  it('defaults to sqlite when process.env is used and unset (no env arg)', () => {
    const original = process.env.JINI_SQLITE_BACKEND;
    delete process.env.JINI_SQLITE_BACKEND;
    try {
      expect(resolveSqliteBackendConfig({})).toEqual({ kind: 'sqlite' });
    } finally {
      if (original !== undefined) process.env.JINI_SQLITE_BACKEND = original;
    }
  });

  it('treats an explicit empty string the same as unset', () => {
    expect(resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: '' } })).toEqual({ kind: 'sqlite' });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: '  SQLITE  ' } })).toEqual({ kind: 'sqlite' });
  });

  it('throws for an unrecognized backend kind', () => {
    expect(() => resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'mysql' } })).toThrow(SqliteBackendConfigError);
    expect(() => resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'mysql' } })).toThrow(/unknown JINI_SQLITE_BACKEND/);
  });

  it('resolves a full postgres config with defaults for port and sslMode', () => {
    expect(
      resolveSqliteBackendConfig({}, { env: {
        JINI_SQLITE_BACKEND: 'postgres',
        JINI_PG_HOST: 'db.internal',
        JINI_PG_DATABASE: 'jini',
        JINI_PG_USER: 'jini_app',
      } }),
    ).toEqual({
      kind: 'postgres',
      postgres: { host: 'db.internal', port: 5432, database: 'jini', user: 'jini_app', sslMode: 'require' },
    });
  });

  it('honors an explicit port and sslMode', () => {
    expect(
      resolveSqliteBackendConfig({}, { env: {
        JINI_SQLITE_BACKEND: 'postgres',
        JINI_PG_HOST: 'db.internal',
        JINI_PG_PORT: '6543',
        JINI_PG_DATABASE: 'jini',
        JINI_PG_USER: 'jini_app',
        JINI_PG_SSL_MODE: 'disable',
      } }),
    ).toEqual({
      kind: 'postgres',
      postgres: { host: 'db.internal', port: 6543, database: 'jini', user: 'jini_app', sslMode: 'disable' },
    });
  });

  it('accepts verify-full as an sslMode', () => {
    const cfg = resolveSqliteBackendConfig({}, { env: {
      JINI_SQLITE_BACKEND: 'postgres',
      JINI_PG_HOST: 'h',
      JINI_PG_DATABASE: 'd',
      JINI_PG_USER: 'u',
      JINI_PG_SSL_MODE: 'verify-full',
    } });
    expect(cfg.postgres?.sslMode).toBe('verify-full');
  });

  it('falls back to a non-numeric port to 5432', () => {
    const cfg = resolveSqliteBackendConfig({}, { env: {
      JINI_SQLITE_BACKEND: 'postgres',
      JINI_PG_HOST: 'h',
      JINI_PG_PORT: 'not-a-number',
      JINI_PG_DATABASE: 'd',
      JINI_PG_USER: 'u',
    } });
    expect(cfg.postgres?.port).toBe(5432);
  });

  it('throws when postgres is selected without a host', () => {
    expect(() =>
      resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'postgres', JINI_PG_DATABASE: 'd', JINI_PG_USER: 'u' } }),
    ).toThrow(/requires JINI_PG_HOST/);
  });

  it('throws when postgres is selected without a database', () => {
    expect(() =>
      resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'postgres', JINI_PG_HOST: 'h', JINI_PG_USER: 'u' } }),
    ).toThrow(/requires JINI_PG_HOST/);
  });

  it('throws when postgres is selected without a user', () => {
    expect(() =>
      resolveSqliteBackendConfig({}, { env: { JINI_SQLITE_BACKEND: 'postgres', JINI_PG_HOST: 'h', JINI_PG_DATABASE: 'd' } }),
    ).toThrow(/requires JINI_PG_HOST/);
  });
});
