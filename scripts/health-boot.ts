/**
 * scripts/health-boot.ts — milestone 1 gate N ("Harnesses + sync-ownership manifest";
 * foundry/docs/jini-port/extraction-plan.md §7 + §8 task 1).
 *
 * The neutrality-proof harness: pack every real `@jini-ai/*` package `examples/minimal-host`
 * transitively depends on into tarballs, install those tarballs (never a workspace link) into a
 * scratch copy of `examples/minimal-host`, boot/run its entry point from there, and report the
 * result as one JSON line on stdout. This is what catches the class of bug where code only works
 * via a pnpm workspace symlink back into this repo's packages/&lt;name&gt;/src, not a real published-shape package —
 * see examples/minimal-host/README.md and extraction-plan.md §2.4/§7/§12 ("packaging model is
 * already broken; fix it before external consumers").
 *
 * The build/pack/rewrite core lives in `scripts/lib/pack-jini-packages.ts`, shared with
 * `scripts/pack-for-external-use.ts` — this file's own job is the boot-and-verify half: install
 * into a scratch dir, prove no symlinks leaked in, run the entry point, delete everything after.
 *
 * Run as `tsx scripts/health-boot.ts` from the repo root. Exits non-zero (after printing the
 * error to stderr) on any failure; always cleans up its scratch directories, on both success and
 * failure.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAndPackClosure, jiniDependencyNames, readPackageJson } from './lib/pack-jini-packages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');
const minimalHostDir = join(repoRoot, 'examples', 'minimal-host');

/** Recursively asserts that nothing under a directory is a symlink — the actual proof that installed `@jini-ai/*` packages are real copies, not workspace links back into this repo. */
function assertNoSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`health-boot: found a symlink at ${entryPath} — the scratch install must contain real copies, never a workspace link`);
    }
    if (stat.isDirectory()) assertNoSymlinks(entryPath);
  }
}

async function main(): Promise<void> {
  const hostPkg = readPackageJson(minimalHostDir);
  const rootDeps = jiniDependencyNames(hostPkg);
  if (rootDeps.length === 0) {
    throw new Error(
      'health-boot: examples/minimal-host/package.json has no @jini-ai/* dependencies — nothing to pack. ' +
        'Add at least one @jini-ai/* dependency (e.g. @jini-ai/server) first.',
    );
  }

  const packDestDir = mkdtempSync(join(tmpdir(), 'jini-health-boot-tarballs-'));
  const scratchRoot = mkdtempSync(join(tmpdir(), 'jini-health-boot-host-'));

  try {
    // 1-3: build every package in the closure, dependency-first, pack each, rewrite @jini-ai/* deps
    // to file: sibling tarball paths — the shared core both this file and pack-for-external-use.ts use.
    const { closure, tarballPathByName } = buildAndPackClosure(repoRoot, packagesDir, rootDeps, packDestDir);
    const packedTarballs = closure.map((name) => tarballPathByName.get(name)!);

    // 4. Copy examples/minimal-host into a scratch directory and rewrite its own @jini-ai/* deps to
    //    point at the packed tarballs (never `workspace:*`).
    const scratchHostDir = join(scratchRoot, 'minimal-host');
    mkdirSync(scratchHostDir, { recursive: true });
    cpSync(join(minimalHostDir, 'src'), join(scratchHostDir, 'src'), { recursive: true });

    const rewrittenHostDeps: Record<string, string> = { ...(hostPkg.dependencies ?? {}) };
    for (const depName of Object.keys(rewrittenHostDeps)) {
      if (!depName.startsWith('@jini-ai/')) continue;
      const depTarball = tarballPathByName.get(depName);
      if (!depTarball) throw new Error(`health-boot: examples/minimal-host's dependency "${depName}" was not packed`);
      rewrittenHostDeps[depName] = `file:${depTarball}`;
    }
    writeFileSync(
      join(scratchHostDir, 'package.json'),
      JSON.stringify({ ...hostPkg, dependencies: rewrittenHostDeps }, null, 2),
    );

    // 5. Install for real — `npm install` against local tarball file: paths, entirely outside
    //    this repo's pnpm workspace, so there is no workspace: protocol and nothing to symlink.
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: scratchHostDir, stdio: 'inherit' });

    const scratchNodeModulesJini = join(scratchHostDir, 'node_modules', '@jini-ai');
    if (!existsSync(scratchNodeModulesJini)) {
      throw new Error(`health-boot: expected ${scratchNodeModulesJini} to exist after npm install`);
    }
    assertNoSymlinks(scratchNodeModulesJini);

    // 6. Boot/run the entry point from the scratch copy — a real exercise of the packed
    //    dependency (constructs+starts a daemon, does a real HTTP round trip, shuts it down).
    const bootOutput = execFileSync('node', ['src/index.ts'], { cwd: scratchHostDir, encoding: 'utf8' });
    if (!bootOutput.includes('MINIMAL_HOST_BOOT_OK')) {
      throw new Error(`health-boot: entry point did not report MINIMAL_HOST_BOOT_OK. Output:\n${bootOutput}`);
    }

    console.log(JSON.stringify({ ok: true, marker: 'HEALTH_BOOT_OK', packedTarballs }));
  } finally {
    // Clean up scratch directories on both success and failure — never anything inside this repo.
    rmSync(packDestDir, { recursive: true, force: true });
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
