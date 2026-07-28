/**
 * scripts/pack-for-external-use.ts
 *
 * Packs real `@jini/*` tarballs for use in a project OUTSIDE this repo, without any real npm
 * publish — same build/pack/`file:`-dependency-rewrite technique `health-boot.ts` uses to prove
 * install-from-tarball works, but the output persists in `dist-tarballs/` instead of a scratch dir
 * that gets deleted after boot-proving. This is the fast path to "try Jini in another project"
 * before an actual `npm publish` decision (registry access, public vs restricted, which packages)
 * has been made.
 *
 * Usage:
 *   tsx scripts/pack-for-external-use.ts                    # every @jini/* package
 *   tsx scripts/pack-for-external-use.ts --only core,daemon # just these + their @jini/* deps
 *
 * Output: `dist-tarballs/*.tgz` at the repo root (gitignored), plus a printed summary of exactly
 * how to reference them from another project's package.json.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAndPackClosure, discoverJiniPackages } from './lib/pack-jini-packages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');
const outDir = join(repoRoot, 'dist-tarballs');

function parseOnlyFlag(argv: readonly string[]): string[] | null {
  const idx = argv.indexOf('--only');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value) throw new Error('pack-for-external-use: --only requires a comma-separated package list, e.g. --only core,daemon');
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const registry = discoverJiniPackages(packagesDir);

  const onlyShortNames = parseOnlyFlag(process.argv.slice(2));
  const rootNames = onlyShortNames
    ? onlyShortNames.map((short) => {
        const full = `@jini/${short}`;
        if (!registry.has(full)) {
          throw new Error(`pack-for-external-use: "${short}" (${full}) is not a real package under packages/*`);
        }
        return full;
      })
    : [...registry.keys()];

  if (rootNames.length === 0) {
    throw new Error('pack-for-external-use: no @jini/* packages found under packages/*');
  }

  // Fresh output every run — a stale tarball for a package no longer in this run's closure would
  // silently look installable via `file:` while actually being days out of date.
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  console.log(`Packing ${rootNames.length} root package(s) and their @jini/* closure into ${outDir}...`);
  const { closure, tarballPathByName } = buildAndPackClosure(repoRoot, packagesDir, rootNames, outDir);

  console.log(`\nPacked ${closure.length} package(s):\n`);
  const usageLines: string[] = [];
  for (const name of closure) {
    const tarballPath = tarballPathByName.get(name)!;
    console.log(`  ${name} -> ${tarballPath}`);
    usageLines.push(`    "${name}": "file:${tarballPath}"`);
  }

  console.log(
    '\nTo use these in another project, add to its package.json "dependencies" (only the ones you actually need — file: entries pull in their own @jini/* deps automatically via the rewritten tarballs):\n',
  );
  console.log(`  {\n${usageLines.join(',\n')}\n  }`);
  console.log('\nThen run npm install (or pnpm install / yarn install) in that project. No workspace link, no registry access needed.');
  console.log(`\nRe-run this script any time after changing source — it always rebuilds from scratch, dist-tarballs/ is not incremental.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
