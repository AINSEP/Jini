/** Offline packed imports use plain Node in a disposable directory, never workspace symlinks. */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the fixture in this package's rootDir; packing siblings uses their built output only.
export const packages = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Creates an isolated ESM consumer directory; filesystem errors propagate to the test. */
export function fixture({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  return dir;
}

/** Packs built output offline into the consumer; npm, JSON and tar failures propagate. */
export function pack({ dir, name }: { dir: string; name: string }): void {
  const source = join(packages, name);
  const dest = join(dir, 'node_modules', '@jini-ai', name);
  mkdirSync(dest, { recursive: true });
  const archives: { filename: string }[] = JSON.parse(execFileSync('npm', [
    'pack', '--offline', '--ignore-scripts', '--json', '--cache', join(dir, 'npm-cache'),
    '--pack-destination', dir,
  ], { cwd: source, encoding: 'utf8' }));
  const archive = archives[0];
  if (!archive) throw new Error('npm pack returned no archive');
  execFileSync('tar', ['-xzf', join(dir, archive.filename), '-C', dest, '--strip-components', '1']);
}

/**
 * Copies a real dependency without workspace links or nested node_modules; filesystem errors propagate.
 * @complexity Time and disk space scale with the copied package contents.
 */
export function copyPackage({ dir, name, source }: { dir: string; name: string; source: string }): void {
  const dest = join(dir, 'node_modules', name);
  const root = realpathSync(source);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(root, dest, {
    recursive: true,
    filter: path => !relative(root, path).split(sep).includes('node_modules'),
  });
}

/** Runs an isolated ESM probe and returns stdout, stderr, status and spawn errors for assertions. */
export function run({ dir, source }: { dir: string; source: string }): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, encoding: 'utf8' });
}
