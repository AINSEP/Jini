/**
 * scripts/publish-pending.ts
 *
 * The npm step of `.github/workflows/publish.yml`: publishes every public `@jini-ai/*` package
 * whose package.json version is not on npm yet, dependency-first. Packages already at their
 * version on npm are skipped, so re-running after a partial failure is safe.
 *
 * Each package is `pnpm pack`ed (which rewrites `workspace:*` to real versions), the tarball is
 * checked for a leftover `workspace:` range and for `.map` files, and then `npm publish <tarball>
 * --access public --provenance` uploads it. Authentication is npm trusted publishing (the job's
 * GitHub OIDC token), so there is no token here; the workflow must already have built `dist/`.
 *
 * Usage:
 *   tsx scripts/publish-pending.ts          # publish (CI only)
 *   tsx scripts/publish-pending.ts --plan   # read-only: print what would be published
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeClosure, discoverJiniPackages, type JiniPackageEntry } from './lib/pack-jini-packages.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** True when npm already has `name@version`; a 404 means not yet, any other failure throws. */
function isOnNpm(name: string, version: string): boolean {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim() === version;
  if (/E404/.test(result.stderr)) return false;
  throw new Error(`npm view ${name}@${version} failed:\n${result.stderr}`);
}

function packAndCheck(name: string, entry: JiniPackageEntry): string {
  const outDir = mkdtempSync(join(tmpdir(), 'jini-publish-'));
  execFileSync('pnpm', ['pack', '--pack-destination', outDir], { cwd: entry.dir, stdio: 'inherit' });
  const tarball = join(outDir, readdirSync(outDir).find((file) => file.endsWith('.tgz'))!);
  const manifest = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  if (manifest.includes('workspace:')) throw new Error(`${name}: packed package.json still has a workspace: range`);
  const maps = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter((path) => path.endsWith('.map'));
  if (maps.length > 0) throw new Error(`${name}: tarball contains source maps, e.g. ${maps[0]}`);
  return tarball;
}

function main(): void {
  const planOnly = process.argv.includes('--plan');
  const registry = discoverJiniPackages(join(repoRoot, 'packages'));
  const order = computeClosure(registry, [...registry.keys()]).filter((name) => registry.get(name)!.pkg.private !== true);

  const pending = order.filter((name) => {
    const version = registry.get(name)!.pkg.version!;
    const published = isOnNpm(name, version);
    console.log(`${published ? 'published' : 'PENDING  '}  ${name}@${version}`);
    return !published;
  });
  console.log(`\n${pending.length} of ${order.length} public package(s) to publish.`);
  if (planOnly) return;

  for (const name of pending) {
    const tarball = packAndCheck(name, registry.get(name)!);
    execFileSync('npm', ['publish', tarball, '--access', 'public', '--provenance'], { stdio: 'inherit' });
  }
}

main();
