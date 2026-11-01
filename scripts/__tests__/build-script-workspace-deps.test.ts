/** Build-order guard. `pnpm -r run build` orders packages only by their declared dependencies, so a
 * build script that runs a file out of a sibling package (`node --import tsx ../provider-plugins/scripts/build.ts`)
 * loads that file's workspace imports, which may not be built yet. Release 0.6.16 broke this way: five
 * plugin distributions ran provider-plugins' build.ts, which imports `@jini-ai/cookie-consent/client`,
 * before cookie-consent's dist existed (publish.yml run 41332429618).
 * Rule: such a package declares the sibling package itself, or every workspace package that the
 * sibling file reaches through runtime imports. Plugin distributions must use the second form,
 * because the isolation gate forbids any declaration of @jini-ai/provider-plugins. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { discoverJiniPackages, type JiniPackageEntry } from '../lib/pack-jini-packages.js';
import { extractImports, REPO_ROOT } from '../lib/walk-imports.js';

const buildScripts = ['prebuild', 'build', 'postbuild'] as const;
const siblingFile = /(?:^|[\s"'=])\.\.\/([^/\s"']+)\/(\S+?\.(?:[cm]?[jt]s|tsx))(?=$|[\s"';&|])/g;
type Manifest = JiniPackageEntry['pkg'] & Partial<Record<'devDependencies' | 'peerDependencies' | 'optionalDependencies', Record<string, string>>>;

function declared({ pkg }: { pkg: Manifest }): Set<string> {
  return new Set([pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]
    .flatMap(field => Object.keys(field ?? {})));
}

/** tsx resolves a `.js` specifier to its `.ts` source; try the source spellings first. */
function sourceFile({ path }: { path: string }): string | undefined {
  const stem = path.replace(/\.[cm]?js$/, '');
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, path, join(path, 'index.ts')].find(file => existsSync(file) && statSync(file).isFile());
}

function packageName({ specifier }: { specifier: string }): string | undefined {
  const match = /^(@jini-ai\/[^/]+)/.exec(specifier);
  return match?.[1];
}

/** Workspace packages reached from `entry` through runtime imports, following relative imports only. */
function runtimeWorkspaceImports({ entry }: { entry: string }): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.shift(); file; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of extractImports(file)) {
      if (ref.typeOnly) continue;
      const name = packageName(ref);
      if (name) found.add(name);
      const next = ref.specifier.startsWith('.') ? sourceFile({ path: resolve(dirname(file), ref.specifier) }) : undefined;
      if (next) queue.push(next);
    }
  }
  return found;
}

function siblingReferences({ entry }: { entry: JiniPackageEntry }): { dir: string; file: string }[] {
  const scripts = (entry.pkg as { scripts?: Record<string, string> }).scripts ?? {};
  return buildScripts.flatMap(name => [...(scripts[name] ?? '').matchAll(siblingFile)])
    .map(match => ({ dir: resolve(entry.dir, '..', match[1]!), file: resolve(entry.dir, '..', match[1]!, match[2]!) }));
}

/** @returns one line per undeclared build-order edge, `package: missing name (via file)`. */
export function checkBuildScriptWorkspaceDeps({ repoRoot }: { repoRoot: string }): string[] {
  const registry = [...discoverJiniPackages(repoRoot).values()];
  const byDir = new Map(registry.map(entry => [resolve(entry.dir), entry]));
  const violations: string[] = [];
  for (const entry of registry) {
    const names = declared({ pkg: entry.pkg as Manifest });
    for (const ref of siblingReferences({ entry })) {
      const sibling = byDir.get(ref.dir);
      if (!sibling || sibling === entry || names.has(sibling.pkg.name!)) continue;
      const source = sourceFile({ path: ref.file });
      const needed = source ? runtimeWorkspaceImports({ entry: source }) : new Set([sibling.pkg.name!]);
      for (const name of [...needed].filter(item => item !== sibling.pkg.name && !names.has(item)).sort()) {
        violations.push(`${entry.pkg.name}: missing ${name} (via ${relative(repoRoot, ref.file)})`);
      }
    }
  }
  return violations.sort();
}

it('declares every workspace package a build script loads from a sibling package', () => {
  expect(checkBuildScriptWorkspaceDeps({ repoRoot: REPO_ROOT })).toEqual([]);
});

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function write(file: string, value: unknown): void {
  const target = join(root!, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}

it('follows relative runtime imports, ignores type-only imports, and accepts either declaration form', () => {
  root = mkdtempSync(join(tmpdir(), 'jini-build-order-'));
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('packages/tool/package.json', { name: '@jini-ai/tool' });
  write('packages/tool/scripts/build.ts', "import '../src/a.js';\nimport type { T } from '@jini-ai/types-only';");
  write('packages/tool/src/a.ts', "import { x } from '@jini-ai/needed/client';");
  write('packages/leaf/package.json', { name: '@jini-ai/leaf', scripts: { build: 'node --import tsx ../tool/scripts/build.ts leaf .' } });
  expect(checkBuildScriptWorkspaceDeps({ repoRoot: root })).toEqual(['@jini-ai/leaf: missing @jini-ai/needed (via packages/tool/scripts/build.ts)']);
  write('packages/leaf/package.json', { name: '@jini-ai/leaf', scripts: { build: 'node ../tool/scripts/build.ts' }, devDependencies: { '@jini-ai/needed': 'workspace:^' } });
  expect(checkBuildScriptWorkspaceDeps({ repoRoot: root })).toEqual([]);
  write('packages/leaf/package.json', { name: '@jini-ai/leaf', scripts: { build: 'node ../tool/scripts/build.ts' }, devDependencies: { '@jini-ai/tool': 'workspace:^' } });
  expect(checkBuildScriptWorkspaceDeps({ repoRoot: root })).toEqual([]);
});
