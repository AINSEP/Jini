/** Physical installs exercise the published shim boundary without workspace resolution or module mocks.
 * Build core, db and infra before running this test.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('outbox works without db; both compatibility entries work when the host installs db', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'jini-infra-nodb-'));
  try {
    // Copy real build output: symlinking infra would silently resolve db from the workspace.
    for (const name of ['core', 'infra']) {
      const installed = join(fixture, 'node_modules/@jini-ai', name);
      mkdirSync(installed, { recursive: true });
      cpSync(join(packagesRoot, name, 'dist'), join(installed, 'dist'), { recursive: true });
      cpSync(join(packagesRoot, name, 'package.json'), join(installed, 'package.json'));
    }
    const absent = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const outbox = await import('@jini-ai/infra/events/outbox');
      const missing = [];
      for (const entry of ['@jini-ai/infra/db/core', '@jini-ai/infra/db/sqlite']) {
        try { await import(entry); }
        catch (error) { missing.push({ code: error.code, db: error.message.includes("Cannot find package '@jini-ai/db'") }); }
      }
      process.stdout.write(JSON.stringify({ attempts: outbox.MAX_OUTBOX_ATTEMPTS,
        backoff: outbox.computeOutboxBackoffMs({ attempts: 2, random: () => 0.5 }), missing }));
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(absent)).toEqual({ attempts: 6, backoff: 45000, missing: [
      { code: 'ERR_MODULE_NOT_FOUND', db: true }, { code: 'ERR_MODULE_NOT_FOUND', db: true },
    ] });

    const installedDb = join(fixture, 'node_modules/@jini-ai/db');
    mkdirSync(installedDb, { recursive: true });
    cpSync(join(packagesRoot, 'db/dist'), join(installedDb, 'dist'), { recursive: true });
    cpSync(join(packagesRoot, 'db/package.json'), join(installedDb, 'package.json'));
    const present = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const core = await import('@jini-ai/infra/db/core');
      const sqlite = await import('@jini-ai/infra/db/sqlite');
      const dbCore = await import('@jini-ai/db/core');
      const dbSqlite = await import('@jini-ai/db/sqlite');
      const pragmas = [];
      const connection = { pragma(value) { pragmas.push(value); } };
      const opened = sqlite.openSqliteConnection({ filePath: ':memory:', open: () => connection });
      process.stdout.write(JSON.stringify({
        coreNames: Object.keys(core).sort(), sqliteNames: Object.keys(sqlite).sort(),
        sameCore: core.restorePointFilename === dbCore.restorePointFilename,
        sameSqlite: sqlite.SqliteDbOpsAdapter === dbSqlite.SqliteDbOpsAdapter,
        filename: core.restorePointFilename({ scopeId: 'a/b', watermarkAtCapture: 3, timestamp: 4 }),
        opened: opened === connection, pragmas,
      }));
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(present)).toEqual({
      coreNames: ['restorePointFilename', 'sanitizeForFilename'],
      sqliteNames: ['DEFAULT_PRAGMAS', 'SqliteDbOpsAdapter', 'openSqliteConnection'],
      sameCore: true, sameSqlite: true, filename: 'restore-point-a_b-wm3-4.db', opened: true,
      pragmas: ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000'],
    });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
