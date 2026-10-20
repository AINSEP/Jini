// Analysis-only source resolution. Runtime/public exports remain owned by package.json.
// Patterns mirror pnpm-workspace.yaml, including the legacy nested forms package.
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const workspacePackages = globSync(['packages/*/package.json', 'packages/cms/forms/package.json'], { cwd: repoRoot })
  .sort().map(file => ({ directory: dirname(file), manifest: JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8')) }));

function targets(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([condition]) => condition !== 'types').flatMap(([, target]) => targets(target));
}

function sourceTarget(directory, target) {
  const source = target.replace(/^\.\/dist\/(?:cjs\/)?/, './src/');
  if (source.includes('*')) return source;
  const stem = source.replace(/\.(?:[cm]?js|jsx)$/, '');
  return [stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.cts', source]
    .find(candidate => existsSync(resolve(repoRoot, directory, candidate))) ?? source;
}

export const publicEntries = workspacePackages.flatMap(({ directory, manifest }) => {
  const exports = typeof manifest.exports === 'string' ? { '.': manifest.exports } : manifest.exports ?? {};
  return Object.entries(exports).flatMap(([subpath, value]) => [...new Set(targets(value))].flatMap(target => {
    const specifier = subpath === '.' ? manifest.name : manifest.name + subpath.slice(1);
    const source = relative(repoRoot, resolve(repoRoot, directory, sourceTarget(directory, target))).replaceAll('\\', '/');
    if (!source.includes('*')) return [{ directory, specifier, source }];
    // Wildcard code exports (admin/contracts/* and db/recovery/*) publish each matching
    // source file. Resolve those concretely; asset wildcards don't create JS graph edges.
    if (!/\.[cm]?js$/.test(source)) return [];
    const pattern = source.replace(/\.[cm]?js$/, '.{ts,tsx,mts,cts,js,mjs,cjs}');
    const [before, after] = source.replace(/\.[cm]?js$/, '').split('*');
    return globSync(pattern, { cwd: repoRoot }).map(file => {
      const emittedStem = file.replace(/\.[cm]?[jt]sx?$/, '');
      const capture = emittedStem.slice(before.length, after ? -after.length : undefined);
      return { directory, specifier: specifier.replace('*', capture), source: file };
    });
  }));
});

export const binSources = workspacePackages.flatMap(({ directory, manifest }) => {
  const bin = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
  return bin.map(target => relative(repoRoot, resolve(repoRoot, directory, sourceTarget(directory, target))).replaceAll('\\', '/'));
});

// dependency-cruiser reads only `resolve` via its webpackConfig option; no webpack dependency.
// Exact aliases keep undeclared private subpaths unresolved; wildcard code exports above
// expand to exact aliases. Wildcard assets retain normal package resolution.
export default { resolve: {
  alias: Object.fromEntries(publicEntries.filter(entry => !entry.specifier.includes('*'))
    .map(entry => [entry.specifier + '$', resolve(repoRoot, entry.source)])),
  extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
} };
