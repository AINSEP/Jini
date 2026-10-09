/**
 * scripts/publish-pending.ts
 *
 * The npm step of `.github/workflows/publish.yml`: publishes every public `@jini-ai/*` package
 * whose package.json version is not on npm yet, dependency-first. Packages already at their
 * version on npm are skipped, so re-running after a partial failure is safe. A package that has
 * never been published is skipped with a warning too: it has no npm settings page yet, so no
 * trusted publisher, and this workflow cannot authenticate for it.
 *
 * Each package is `pnpm pack`ed (which rewrites `workspace:*` to real versions), the tarball is
 * checked for a leftover `workspace:` range, `.map` files and compiled tests, and then `npm publish <tarball>
 * --access public --provenance` uploads it. Authentication is npm trusted publishing (the job's
 * GitHub OIDC token), so there is no token here; the workflow must already have built `dist/`.
 * When `GITHUB_STEP_SUMMARY` is set, the outcome per package is written to the job summary.
 *
 * Usage:
 *   tsx scripts/publish-pending.ts                        # publish (CI only)
 *   tsx scripts/publish-pending.ts --only ui,chat         # just these (short or full names)
 *   tsx scripts/publish-pending.ts --plan [--only ...]    # read-only: print what would happen
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeClosure, discoverJiniPackages, type JiniPackageEntry } from './lib/pack-jini-packages.js';
import { assertPackedExports } from './lib/packed-exports.js';
import { assertCompatiblePeerRanges } from './lib/peer-range-compatibility.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type NpmState = 'on-npm' | 'pending' | 'never-published';

/** Where `name@version` stands on npm; a 404 on the name means never published, any other failure throws. */
function npmState(name: string, version: string): NpmState {
  const result = spawnSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (/E404/.test(result.stderr)) return 'never-published';
    throw new Error(`npm view ${name} failed:\n${result.stderr}`);
  }
  const versions = [JSON.parse(result.stdout) as string | string[]].flat();
  return versions.includes(version) ? 'on-npm' : 'pending';
}

/** `--only a,b` (short or full names) narrows the run; an unknown name fails before anything is published. */
function parseOnly(argv: readonly string[], known: ReadonlySet<string>): Set<string> | null {
  const idx = argv.indexOf('--only');
  if (idx === -1 || !argv[idx + 1]?.trim()) return null;
  const names = argv[idx + 1]!.split(/[,\s]+/).filter(Boolean).map((n) => (n.startsWith('@') ? n : `@jini-ai/${n}`));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) throw new Error(`--only: not a public @jini-ai package: ${unknown.join(', ')}`);
  return new Set(names);
}

/**
 * Dependency-first over `dependencies` AND `peerDependencies`. `computeClosure` follows only
 * `dependencies` (all a build needs), which put admin ahead of the ui/cms versions it peers on and
 * chat ahead of protocol/ui: between those uploads, or for good if the run stops part-way, npm
 * would serve a package whose peer range nothing satisfies.
 */
function publishOrder(registry: ReadonlyMap<string, JiniPackageEntry>, names: readonly string[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string, chain: readonly string[]): void => {
    if (visited.has(name)) return;
    if (chain.includes(name)) throw new Error(`publish order: cyclic @jini-ai/* dependency/peer: ${[...chain, name].join(' -> ')}`);
    const { pkg } = registry.get(name)!;
    const peers = pkg.peerDependencies as Record<string, string> | undefined;
    const siblings = Object.keys({ ...pkg.dependencies, ...peers }).filter((dep) => registry.has(dep));
    for (const dep of siblings) visit(dep, [...chain, name]);
    visited.add(name);
    order.push(name);
  };
  for (const name of names) visit(name, []);
  return order;
}

function packAndCheck(name: string, entry: JiniPackageEntry): string {
  const outDir = mkdtempSync(join(tmpdir(), 'jini-publish-'));
  execFileSync('pnpm', ['pack', '--pack-destination', outDir], { cwd: entry.dir, stdio: 'inherit' });
  const tarball = join(outDir, readdirSync(outDir).find((file) => file.endsWith('.tgz'))!);
  const manifest = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  if (manifest.includes('workspace:')) throw new Error(`${name}: packed package.json still has a workspace: range`);
  const paths = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n');
  assertPackedExports({ manifest: JSON.parse(manifest), packedPaths: paths });
  const maps = paths.filter((path) => path.endsWith('.map'));
  if (maps.length > 0) throw new Error(`${name}: tarball contains source maps, e.g. ${maps[0]}`);
  // tsc emits every test under src/ into dist/; each package's "files" must negate them.
  const tests = paths.filter((path) => /\/__tests__\/|\.test\.[^/]+$/.test(path));
  if (tests.length > 0) throw new Error(`${name}: tarball contains compiled tests, e.g. ${tests[0]}`);
  return tarball;
}

function writeSummary(rows: ReadonlyArray<readonly [string, string]>): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = ['## npm publish', '', '| Package | Result |', '| --- | --- |', ...rows.map(([pkg, result]) => `| \`${pkg}\` | ${result} |`)];
  appendFileSync(file, `${lines.join('\n')}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const planOnly = argv.includes('--plan');
  const registry = discoverJiniPackages(repoRoot);
  // Check the full public release set, including already-published and optional peer declarations.
  assertCompatiblePeerRanges({ packages: [...registry.values()].map(entry => entry.pkg) });
  const publicNames = publishOrder(registry, computeClosure(registry, [...registry.keys()])).filter(
    (name) => registry.get(name)!.pkg.private !== true,
  );
  const only = parseOnly(argv, new Set(publicNames));
  const order = only ? publicNames.filter((name) => only.has(name)) : publicNames;

  const rows: Array<[string, string]> = [];
  const pending: string[] = [];
  for (const name of order) {
    const version = registry.get(name)!.pkg.version!;
    const state = npmState(name, version);
    console.log(`${state.padEnd(15)}  ${name}@${version}`);
    if (state === 'pending') pending.push(name);
    if (state === 'on-npm') rows.push([`${name}@${version}`, 'skipped: already on npm']);
    if (state === 'never-published') {
      console.log(`::warning::${name}@${version} skipped: never published, so npm has no trusted publisher for it yet`);
      rows.push([`${name}@${version}`, 'skipped: never published (no trusted publisher possible yet)']);
    }
  }
  console.log(`\n${pending.length} of ${order.length} package(s) to publish.`);

  try {
    for (const name of planOnly ? [] : pending) {
      const tarball = packAndCheck(name, registry.get(name)!);
      execFileSync('npm', ['publish', tarball, '--access', 'public', '--provenance'], { stdio: 'inherit' });
      rows.push([`${name}@${registry.get(name)!.pkg.version}`, 'published']);
    }
  } finally {
    writeSummary(rows);
  }
}

main();
