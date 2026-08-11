/**
 * The behavioural counterpart to `pnpm guard`'s R12 static check.
 *
 * R12 proves the neutral core never *writes* an import that reaches a driver. This proves the
 * consequence R12 exists for: that a consumer who installed `@jini-ai/infra` WITHOUT the
 * optional `better-sqlite3` / `drizzle-orm` peers can still import `./db/core` and have it load.
 *
 * It is a real install fixture rather than a mock: the built `dist/` and `package.json` are
 * copied into a throwaway directory with a `node_modules` containing nothing else, so bare
 * specifiers genuinely cannot resolve. Copying (not symlinking) is load-bearing — a symlink back
 * into `packages/infra` would let Node walk up into this package's own `node_modules`, find
 * `better-sqlite3`, and make the test pass for the wrong reason.
 *
 * The `./db/sqlite` case below is the positive control. Without it, a fixture that failed to
 * exclude the driver would still show `./db/core` loading fine, and the test would report
 * success while proving nothing.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The subpaths under test, as data. They are interpolated into the child snippets below rather
 * than written inline, because the guard's shared import extractor matches `import('<literal>')`
 * anywhere in a file — including inside a string literal that is program *input* rather than a
 * real import (the same false-positive class R11's `ok-string-literal-lookalike` fixture
 * documents). Interpolating breaks the literal-quote-after-paren shape that regex keys on, and
 * naming the specifiers once is better anyway given each is used more than once.
 */
const CORE_ENTRY = '@jini-ai/infra/db/core';
const SQLITE_ENTRY = '@jini-ai/infra/db/sqlite';

let fixtureDir: string;

/** Runs an ESM snippet with `cwd` as the bare-specifier resolution base. */
function runInFixture(source: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: fixtureDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeAll(() => {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: packageRoot, stdio: 'pipe' });

  fixtureDir = mkdtempSync(join(tmpdir(), 'jini-infra-nodriver-'));
  const installedAt = join(fixtureDir, 'node_modules', '@jini-ai', 'infra');
  mkdirSync(dirname(installedAt), { recursive: true });
  mkdirSync(installedAt, { recursive: true });
  cpSync(join(packageRoot, 'dist'), join(installedAt, 'dist'), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(installedAt, 'package.json'));
}, 180_000);

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe('@jini-ai/infra/db/core in an install with no driver present', () => {
  it('built a dist to test against', () => {
    expect(existsSync(join(packageRoot, 'dist', 'db', 'core', 'index.js'))).toBe(true);
  });

  it('does not ship better-sqlite3 into the fixture (control for the assertions below)', () => {
    expect(existsSync(join(fixtureDir, 'node_modules', 'better-sqlite3'))).toBe(false);
    expect(existsSync(join(fixtureDir, 'node_modules', 'drizzle-orm'))).toBe(false);
  });

  it('imports cleanly and exposes its runtime exports', () => {
    const result = runInFixture(
      `const m = await import(${JSON.stringify(CORE_ENTRY)});\n` +
        "process.stdout.write(typeof m.sanitizeForFilename + ',' + typeof m.restorePointFilename);",
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function,function');
  });

  it('actually works, not merely resolves', () => {
    const result = runInFixture(
      `const { restorePointFilename } = await import(${JSON.stringify(CORE_ENTRY)});\n` +
        "process.stdout.write(restorePointFilename({ scopeId: 'a/b', watermarkAtCapture: 3, timestamp: 4 }));",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('restore-point-a_b-wm3-4.db');
  });

  it('POSITIVE CONTROL: ./db/sqlite fails in the same fixture, proving the driver is genuinely absent', () => {
    const result = runInFixture(`await import(${JSON.stringify(SQLITE_ENTRY)});`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
  });
});
