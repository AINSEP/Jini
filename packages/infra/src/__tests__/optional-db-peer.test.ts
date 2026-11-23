/** Physical installs exercise the published outbox boundary without workspace resolution or module mocks.
 * Build core and infra before running this test.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('outbox works without db, and the retired database shim entries are not exported', () => {
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
        try { await import(entry); missing.push({ entry, loaded: true }); }
        catch (error) { missing.push({ entry, code: error.code }); }
      }
      process.stdout.write(JSON.stringify({ attempts: outbox.MAX_OUTBOX_ATTEMPTS,
        backoff: outbox.computeOutboxBackoffMs({ attempts: 2, random: () => 0.5 }), missing }));
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(absent)).toEqual({ attempts: 6, backoff: 45000, missing: [
      { entry: '@jini-ai/infra/db/core', code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      { entry: '@jini-ai/infra/db/sqlite', code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
    ] });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
