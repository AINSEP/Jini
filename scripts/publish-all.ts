/**
 * scripts/publish-all.ts
 *
 * Publishes every real `@jini-ai/*` package to the real npm registry, in dependency-first order,
 * via `pnpm publish` — which (unlike plain `npm publish`) automatically rewrites each package's
 * `workspace:*` internal dependencies to the real resolved semver version before publishing, so a
 * published package never carries an unresolvable `workspace:*` dependency spec.
 *
 * Usage:
 *   tsx scripts/publish-all.ts             # every @jini-ai/* package
 *   tsx scripts/publish-all.ts --only core,daemon   # just these (their @jini-ai/* deps must already
 *                                                      be published, or resolve from the registry)
 *   tsx scripts/publish-all.ts --dry-run   # pnpm publish --dry-run, no real publish
 *
 * Each package's own `package.json` "publishConfig" governs access level — this script does not
 * override it. Requires `npm whoami` to already resolve (a real, already-authenticated npm
 * session) — this script never handles login.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeClosure, discoverJiniPackages } from './lib/pack-jini-packages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');

function parseOnlyFlag(argv: readonly string[]): string[] | null {
  const idx = argv.indexOf('--only');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value) throw new Error('publish-all: --only requires a comma-separated package list, e.g. --only core,daemon');
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Idempotency check: `--only`'s dependency closure frequently re-includes packages the caller
 * didn't ask for and that are already live (e.g. most packages depend on `@jini-ai/platform`).
 * Without this, a partial run that already published some of the closure fails immediately on
 * the first already-published package it revisits — `npm publish` refuses to overwrite an
 * existing version — instead of continuing on to the packages that actually still need it.
 */
function isVersionAlreadyPublished(name: string, version: string): boolean {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' }).toString().trim();
    return out === version;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const registry = discoverJiniPackages(packagesDir);

  const onlyShortNames = parseOnlyFlag(process.argv.slice(2));
  const rootNames = onlyShortNames
    ? onlyShortNames.map((short) => {
        const full = `@jini-ai/${short}`;
        if (!registry.has(full)) throw new Error(`publish-all: "${short}" (${full}) is not a real package under packages/*`);
        return full;
      })
    : [...registry.keys()];

  const closure = computeClosure(registry, rootNames);

  try {
    execFileSync('npm', ['whoami'], { stdio: 'pipe' });
  } catch {
    throw new Error('publish-all: not logged in to npm (npm whoami failed) — run `npm login` first, this script never handles auth.');
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Publishing ${closure.length} package(s) in dependency order:\n  ${closure.join('\n  ')}\n`);

  for (const name of closure) {
    const entry = registry.get(name)!;
    const localVersion = entry.pkg.version;
    if (localVersion && isVersionAlreadyPublished(name, localVersion)) {
      console.log(`\n--- skipping ${name}@${localVersion} (already published) ---`);
      continue;
    }
    console.log(`\n--- building ${name} ---`);
    execFileSync('pnpm', ['--filter', name, 'run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

    console.log(`--- publishing ${name} ---`);
    const args = ['publish', '--no-git-checks'];
    if (dryRun) args.push('--dry-run');
    execFileSync('pnpm', args, { cwd: entry.dir, stdio: 'inherit' });
  }

  console.log(`\n${dryRun ? '[dry-run] would have published' : 'Published'} ${closure.length} package(s).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
