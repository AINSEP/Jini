/**
 * scripts/lib/pack-jini-packages.ts
 *
 * Shared core behind `scripts/health-boot.ts` and `scripts/pack-for-external-use.ts`: discover
 * every real `@jini-ai/*` workspace package, compute a dependency-first build/pack order for some
 * root set of them, build each, and `pnpm pack` + rewrite each tarball's own `package.json` so its
 * `@jini-ai/*` dependencies point at sibling tarballs by `file:` path instead of the plain resolved
 * semver `pnpm pack` bakes in for a `workspace:*` dependency — unresolvable against the real npm
 * registry, since these packages are never actually published there from a `workspace:*` pin.
 *
 * Extracted from `health-boot.ts` (2026-07-23) rather than duplicated, once a second caller
 * (`pack-for-external-use.ts`) needed the identical build/pack/rewrite behavior against a
 * persistent output directory instead of a scratch one that gets deleted after boot-proving.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly [key: string]: unknown;
}

export interface JiniPackageEntry {
  readonly dir: string;
  readonly pkg: PackageJson;
}

export function readPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
}

export function jiniDependencyNames(pkg: PackageJson): string[] {
  return Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@jini-ai/'));
}

/** The exact filename `npm pack`/`pnpm pack` produce for a scoped package: `@jini-ai/core@0.0.0` -> `jini-core-0.0.0.tgz`. */
export function tarballFileName(name: string, version: string): string {
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

/**
 * The `packages:` globs of `pnpm-workspace.yaml`, the one list of what is a workspace package.
 * Only the two shapes the file uses are supported — `dir/*` (one level) and a literal path — and
 * anything else throws, so a new glob shape can't silently drop packages from publishing.
 */
export function workspacePackageGlobs(workspaceRoot: string): string[] {
  const lines = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8').split('\n');
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) throw new Error('pack-jini-packages: pnpm-workspace.yaml has no top-level "packages:" list');
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) break;
    globs.push(item[1]!.replace(/^(['"])(.*)\1$/, '$2'));
  }
  return globs;
}

/**
 * Discovers every real `@jini-ai/*` package in the workspace from `pnpm-workspace.yaml`'s globs —
 * never a hardcoded list. Nested members such as `packages/cms/forms` are found because the
 * workspace file lists them; a one-level `packages/*` scan never saw them, so they never published.
 * Private packages are included (dependency closures need them); publish paths filter them out.
 */
export function discoverJiniPackages(workspaceRoot: string): Map<string, JiniPackageEntry> {
  const dirs: string[] = [];
  for (const glob of workspacePackageGlobs(workspaceRoot)) {
    if (glob.startsWith('!') || /[*?{[]/.test(glob.replace(/\/\*$/, ''))) {
      throw new Error(`pack-jini-packages: unsupported pnpm-workspace.yaml glob "${glob}" — only "dir/*" and literal paths`);
    }
    if (!glob.endsWith('/*')) {
      dirs.push(join(workspaceRoot, glob));
      continue;
    }
    const parent = join(workspaceRoot, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(parent, entry.name));
    }
  }
  const registry = new Map<string, JiniPackageEntry>();
  for (const dir of dirs) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    const pkg = readPackageJson(dir);
    if (pkg.name?.startsWith('@jini-ai/')) registry.set(pkg.name, { dir, pkg });
  }
  return registry;
}

/**
 * Walks the transitive `@jini-ai/*` dependency closure starting from `rootNames`, reading each
 * dependency's own `package.json` `"dependencies"` field (never a guessed/hardcoded list). Returns
 * packages in dependency-first (topological) order, since building a dependent's TypeScript
 * project requires its `@jini-ai/*` dependencies' `dist/` to already exist.
 */
export function computeClosure(registry: Map<string, JiniPackageEntry>, rootNames: readonly string[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(name: string, chain: readonly string[]): void {
    if (visited.has(name)) return;
    if (chain.includes(name)) {
      throw new Error(`pack-jini-packages: cyclic @jini-ai/* dependency detected: ${[...chain, name].join(' -> ')}`);
    }
    const entry = registry.get(name);
    if (!entry) {
      throw new Error(`pack-jini-packages: "${name}" is a @jini-ai/* dependency but no matching workspace package was found`);
    }
    for (const dep of jiniDependencyNames(entry.pkg)) visit(dep, [...chain, name]);
    visited.add(name);
    order.push(name);
  }

  for (const name of rootNames) visit(name, []);
  return order;
}

/** Builds one package's TypeScript project (`tsc`), producing the `dist/` that its own `"files"` field packs. */
export function buildPackage(name: string, repoRoot: string): void {
  execFileSync('pnpm', ['--filter', name, 'run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

/**
 * `pnpm pack`s one package into `destDir`, then rewrites the tarball's own `package.json` so every
 * `@jini-ai/*` dependency points at its sibling tarball's file path (`file:<abs path>.tgz`). This is
 * what lets `npm install` build a real, self-contained dependency tree entirely from local
 * tarballs, with no workspace link and no dependency on any registry actually hosting `@jini-ai/*`.
 */
export function packAndRewrite(
  name: string,
  dir: string,
  destDir: string,
  tarballPathByName: ReadonlyMap<string, string>,
): string {
  const raw = execFileSync('pnpm', ['pack', '--json', '--pack-destination', destDir], {
    cwd: dir,
    encoding: 'utf8',
  });
  const packed = JSON.parse(raw) as { readonly filename: string };
  const expected = tarballPathByName.get(name);
  if (expected && expected !== packed.filename) {
    throw new Error(
      `pack-jini-packages: tarball filename mismatch for ${name} — expected "${expected}", pnpm produced "${packed.filename}". ` +
        'The precomputed tarball-path map is out of sync with pnpm pack\'s own naming.',
    );
  }
  const tarballPath = packed.filename;

  const stagingParent = mkdtempSync(join(tmpdir(), 'jini-pack-rewrite-'));
  try {
    const stagingPackageDir = join(stagingParent, 'package');
    execFileSync('tar', ['-xzf', tarballPath, '-C', stagingParent]);

    const packedPkgJsonPath = join(stagingPackageDir, 'package.json');
    const packedPkg = JSON.parse(readFileSync(packedPkgJsonPath, 'utf8')) as PackageJson;
    const rewrittenDeps: Record<string, string> = { ...(packedPkg.dependencies ?? {}) };
    for (const depName of Object.keys(rewrittenDeps)) {
      if (!depName.startsWith('@jini-ai/')) continue;
      const depTarball = tarballPathByName.get(depName);
      if (!depTarball) {
        throw new Error(`pack-jini-packages: ${name}'s packed dependency "${depName}" has no known tarball path`);
      }
      rewrittenDeps[depName] = `file:${depTarball}`;
    }
    writeFileSync(packedPkgJsonPath, JSON.stringify({ ...packedPkg, dependencies: rewrittenDeps }, null, 2));

    // Re-tar in place, replacing pnpm's original (workspace-version-baked) tarball.
    execFileSync('tar', ['-czf', tarballPath, '-C', stagingParent, 'package']);
  } finally {
    rmSync(stagingParent, { recursive: true, force: true });
  }

  return tarballPath;
}

/**
 * Builds and packs every package in `rootNames`'s transitive `@jini-ai/*` closure into `destDir`,
 * each tarball's own dependencies rewritten to `file:` sibling paths. Returns the closure (in
 * dependency-first order) alongside each package's real tarball path — callers decide what to do
 * with the tarballs (boot-prove them and delete, as `health-boot.ts` does; or leave them in place
 * for external consumption, as `pack-for-external-use.ts` does).
 */
export function buildAndPackClosure(
  repoRoot: string,
  rootNames: readonly string[],
  destDir: string,
): { readonly closure: readonly string[]; readonly tarballPathByName: ReadonlyMap<string, string> } {
  const registry = discoverJiniPackages(repoRoot);
  const closure = computeClosure(registry, rootNames);

  for (const name of closure) buildPackage(name, repoRoot);

  const tarballPathByName = new Map<string, string>();
  for (const name of closure) {
    const entry = registry.get(name);
    if (!entry) throw new Error(`pack-jini-packages: unreachable — "${name}" missing from registry`);
    const version = entry.pkg.version ?? '0.0.0';
    tarballPathByName.set(name, join(destDir, tarballFileName(name, version)));
  }

  for (const name of closure) {
    const entry = registry.get(name);
    if (!entry) throw new Error(`pack-jini-packages: unreachable — "${name}" missing from registry`);
    packAndRewrite(name, entry.dir, destDir, tarballPathByName);
  }

  return { closure, tarballPathByName };
}
