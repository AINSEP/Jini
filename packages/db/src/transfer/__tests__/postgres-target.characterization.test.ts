import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPsqlPostgresTarget, InvalidConnectionStringError, parseConnectionString } from '../postgres-target.js';

describe('connection URL compatibility pins', () => {
  it.each(['postgres', 'postgresql'])('parses %s with decoded credentials, default port and application name', protocol => {
    expect(parseConnectionString({ raw: `  ${protocol}://us%40er:p%40ss@localhost/data%20base  ` })).toEqual({
      description: { host: 'localhost', port: '5432', database: 'data base', user: 'us@er' },
      env: { PGHOST: 'localhost', PGPORT: '5432', PGDATABASE: 'data base', PGUSER: 'us@er', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'database-transfer', PGPASSWORD: 'p@ss' },
    });
  });
  it('keeps host override, explicit port, sslmode and application name, without adding an absent password', () => {
    expect(parseConnectionString({ raw: 'postgres://user@localhost:6543/db?host=%2Fvar%2Frun%2Fpostgres&sslmode=require' }, { applicationName: 'host-transfer' })).toEqual({
      description: { host: '/var/run/postgres', port: '6543', database: 'db', user: 'user' },
      env: { PGHOST: '/var/run/postgres', PGPORT: '6543', PGDATABASE: 'db', PGUSER: 'user', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'host-transfer', PGSSLMODE: 'require' },
    });
  });
  it('retains explicitly empty sslmode and omits an empty password', () => {
    const parsed = parseConnectionString({ raw: 'postgres://user:@localhost/db?sslmode=' });
    expect(parsed.env.PGSSLMODE).toBe('');
    expect(parsed.env).not.toHaveProperty('PGPASSWORD');
  });
  it.each([
    { raw: 'not a URL', message: 'the connection string is not a valid postgres:// URL' },
    { raw: 'https://user:secret@localhost/db', message: 'the connection string must start with postgres:// or postgresql://' },
    { raw: 'postgres://user@localhost/', message: 'the connection string must name a host, a user and a database' },
    { raw: 'postgres://localhost/db', message: 'the connection string must name a host, a user and a database' },
    { raw: 'postgres://user@localhost/db?host=', message: 'the connection string must name a host, a user and a database' },
  ])('rejects $raw with its established error type and safe message', ({ raw, message }) => {
    expect(() => parseConnectionString({ raw })).toThrow(InvalidConnectionStringError);
    expect(() => parseConnectionString({ raw })).toThrow(message);
  });
  it('lets malformed percent escapes escape as URIError (reported, not fixed)', () => {
    expect(() => parseConnectionString({ raw: 'postgres://user:%ZZ@localhost/db' })).toThrow(URIError);
  });
  it('leaves single-quoted server data in the public error (reported, not fixed)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jini-psql-redaction-'));
    try {
      // Exercise the existing parentEnv port with a disposable psql executable, without a database.
      const executable = join(directory, 'psql');
      const stderr = `ERROR: rejected 'private-value' and "hidden-value"\n`;
      await writeFile(executable, `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)}); process.exit(1);\n`);
      await chmod(executable, 0o700);
      const target = createPsqlPostgresTarget({ connectionString: 'postgres://user@localhost/db' }, { parentEnv: { PATH: directory } });
      expect(await target.query('SELECT 1')).toEqual({ ok: false, error: `ERROR: rejected 'private-value' and "…"` });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
