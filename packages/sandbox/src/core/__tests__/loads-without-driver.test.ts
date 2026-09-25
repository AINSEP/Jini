/**
 * The behavioural counterpart to `pnpm guard`'s R12 static check.
 *
 * R12 proves `./core` never *writes* an import that reaches an adapter. This proves the
 * consequence R12 exists for: that a consumer who installed `@jini-ai/sandbox` WITHOUT the
 * optional `@e2b/code-interpreter` peer can still import `./core` and have it load.
 *
 * It is a real install fixture rather than a mock: the built `dist/` and `package.json` are
 * copied into a throwaway directory with a `node_modules` containing nothing else, so bare
 * specifiers genuinely cannot resolve. Copying (not symlinking) is load-bearing — a symlink back
 * into `packages/sandbox` would let Node walk up into this package's own `node_modules`, find
 * `@e2b/code-interpreter`, and make the test pass for the wrong reason.
 *
 * The `./e2b` case below is the positive control. Without it, a fixture that failed to exclude
 * the driver would still show `./core` loading fine, and the test would report success while
 * proving nothing.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The subpaths under test, as data. They are interpolated into the child snippets below rather
 * than written inline, because the guard's shared import extractor matches `import('<literal>')`
 * anywhere in a file — including inside a string literal that is program *input* rather than a
 * real import (the same false-positive class R11's `ok-string-literal-lookalike` fixture
 * documents). Interpolating breaks the literal-quote-after-paren shape that regex keys on, and
 * naming the specifiers once is better anyway given each is used more than once.
 */
const CORE_ENTRY = '@jini-ai/sandbox/core';
const E2B_ENTRY = '@jini-ai/sandbox/e2b';

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

  fixtureDir = mkdtempSync(join(tmpdir(), 'jini-sandbox-nodriver-'));
  const installedAt = join(fixtureDir, 'node_modules', '@jini-ai', 'sandbox');
  mkdirSync(dirname(installedAt), { recursive: true });
  mkdirSync(installedAt, { recursive: true });
  cpSync(join(packageRoot, 'dist'), join(installedAt, 'dist'), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(installedAt, 'package.json'));
}, 180_000);

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe('@jini-ai/sandbox/core in an install with no adapter present', () => {
  it('built a dist to test against', () => {
    expect(existsSync(join(packageRoot, 'dist', 'core', 'index.js'))).toBe(true);
  });

  it('does not ship @e2b/code-interpreter into the fixture (control for the assertions below)', () => {
    expect(existsSync(join(fixtureDir, 'node_modules', '@e2b'))).toBe(false);
  });

  it('imports cleanly and exposes its one runtime export (everything else is types)', () => {
    const result = runInFixture(
      `const m = await import(${JSON.stringify(CORE_ENTRY)});\n` +
        "process.stdout.write(JSON.stringify(Object.keys(m)) + ',' + typeof m.SandboxOperationError);",
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('["SandboxOperationError"],function');
  });

  it('POSITIVE CONTROL: ./e2b fails in the same fixture, proving the adapter is genuinely absent', () => {
    const result = runInFixture(`await import(${JSON.stringify(E2B_ENTRY)});`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
  });
});
