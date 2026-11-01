/**
 * Runtime and installation isolation for every exported Jini subpath.
 * Export targets are resolved back to SOURCE, including conditional/wildcard exports;
 * traversal reuses the shared import extractor rather than maintaining another walker.
 *
 * jini.isolation can name shared source paths, override an entry's domain, and register
 * domain roots. The default domain is the first export segment (adapters stay with their
 * domain). `$aggregate` permits a compatibility barrel, never an independent domain.
 * CMS registers here; it must not maintain a parallel cms-only import graph.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { Violation } from './check-engine-boundaries.js';
import { parseSource, sourcePackages, type PackageManifest, type SourcePackage } from './lib/package-sources.js';
import { extractImports, listSourceFiles, REPO_ROOT, type ImportRef } from './lib/walk-imports.js';

import { optionalPeerContractProblems } from '../packages/devops/src/packaging/electron/optional-peers.js';

interface IsolationConfig {
  entries?: Record<string, string>;
  domains?: Record<string, string[]>;
  shared?: string[];
  /** Extra entry-specific runtime restrictions, e.g. CMS's universal/browser entries. */
  forbidden?: Record<string, string[]>;
}
interface Manifest extends PackageManifest {
  sideEffects?: boolean | string[];
  main?: string;
  optionalDependencies?: Record<string, string>;
  jini?: { isolation?: IsolationConfig; entries?: Record<string, string>; runtime?: string; optionalPeers?: Record<string, string> };
}
interface Entry {
  subpath: string;
  domain: string;
  files: string[];
  target: string;
}
interface Package extends SourcePackage {
  manifest: Manifest;
  entries: Entry[];
  roots: { domain: string; path: string }[];
  shared: string[];
}
export interface SubpathClosure {
  package: string;
  subpath: string;
  domain: string;
  files: string[];
  dependencies: string[];
}
export interface IsolationFinding extends Violation {
  package: string;
  subpath: string;
  kind: 'a' | 'b' | 'c' | 'd' | 'resolution' | 'optional-peer';
}
export interface SubpathIsolationAudit {
  closures: SubpathClosure[];
  findings: IsolationFinding[];
}

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
}
function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
/** All runtime conditions count: a clean ESM branch cannot hide a leaking CJS branch. */
function runtimeTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(runtimeTargets);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([key]) => key !== 'types').flatMap(([, target]) => runtimeTargets(target));
}
function sourceFile(base: string): string | undefined {
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '');
  const candidates = [stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.cts',
    base, join(stem, 'index.ts'), join(stem, 'index.tsx')];
  return candidates.find(file => existsSync(file) && statSync(file).isFile());
}
function targetSource(directory: string, target: string): string {
  // CJS is compiled from the same source, not a separate source domain.
  return resolve(directory, target.replace(/^\.\/dist\/(?:cjs\/)?/, './src/'));
}
function exportTargetMatches(pkg: SourcePackage, key: string, target: string, files: string[]): { base: string; matches: { subpath: string; file: string }[] } {
  const base = targetSource(pkg.directory, target);
  let matches: { subpath: string; file: string }[];
  if (base.includes('*')) {
    const [before, after = ''] = base.split('*');
    const compiled = target.startsWith('./dist/');
    const candidates = compiled ? files : listSourceFiles(pkg.directory, { includeJavaScript: true })
      .filter(file => !file.includes('/__tests__/') && !/\.test\./.test(file));
    matches = candidates.flatMap(file => {
      const emitted = compiled ? file.replace(/\.(?:tsx?|mts|cts)$/, extname(base) || '.js') : file;
      if (!emitted.startsWith(before!) || !emitted.endsWith(after)) return [];
      const capture = emitted.slice(before!.length, emitted.length - after.length);
      return [{ subpath: key.replace('*', capture), file }];
    });
  } else {
    const file = sourceFile(base);
    matches = file ? [{ subpath: key, file }] : [];
  }
  return { base, matches };
}

function mergeEntryMatches({ matches, key, subpaths, entries, domain, target }: { matches: { subpath: string; file: string }[]; key: string; subpaths: Record<string, unknown>; entries: Entry[]; domain: string; target: string }): void {
  for (const match of matches) {
    // Node gives an exact export (including null) precedence over a wildcard.
    // A private/null override must never be resurrected by source expansion.
    if (key.includes('*') && Object.hasOwn(subpaths, match.subpath)) continue;
    const prior = entries.find(entry => entry.subpath === match.subpath && entry.domain === domain);
    if (prior) { if (!prior.files.includes(match.file)) prior.files.push(match.file); }
    else entries.push({ subpath: match.subpath, domain, files: [match.file], target });
  }
}

function exportDomain(manifest: Manifest, key: string, base: string): string {
  const config = manifest.jini?.isolation;
  const inferred = key === '.' ? (base.includes('/src/core/') ? 'core' : '$aggregate')
    : key.slice(2).split('/')[0]!;
  const domain = config?.entries?.[key] ?? inferred;
  return domain;
}

function appendExportTarget(pkg: SourcePackage, manifest: Manifest, key: string, target: string, files: string[], subpaths: Record<string, unknown>, entries: Entry[]): void {
  const codeTarget = /\.(?:[cm]?js|jsx|tsx?|mts|cts)$/.test(target);
  if (!codeTarget && !target.includes('*')) return;
  const { base, matches } = exportTargetMatches(pkg, key, target, files);
  const domain = exportDomain(manifest, key, base);
  // Asset-only wildcards (CSS, Markdown, Swift) have no JavaScript runtime closure.
  if (!matches.length && !codeTarget) return;
  // Keep unresolved code entries visible; otherwise a moved source silently disables a guard.
  if (!matches.length) entries.push({ subpath: key, domain, files: [], target });
  mergeEntryMatches({ matches, key, subpaths, entries, domain, target });
}

function exportEntries(pkg: SourcePackage): Entry[] {
  const manifest = pkg.manifest as Manifest;
  const files = listSourceFiles(join(pkg.directory, 'src'), { includeJavaScript: true })
    .filter(file => !file.includes('/__tests__/') && !/\.test\./.test(file));
  const entries: Entry[] = [];
  const rawExports = manifest.exports ?? manifest.main;
  const exports = typeof rawExports === 'string' ? { '.': rawExports } : rawExports ?? {};
  const subpaths = Object.keys(exports).some(key => key.startsWith('.')) ? exports : { '.': exports };
  for (const [key, value] of Object.entries(subpaths)) {
    for (const target of new Set(runtimeTargets(value))) {
      appendExportTarget(pkg, manifest, key, target, files, subpaths, entries);
    }
  }
  return entries;
}
function addFileRoots(pkg: SourcePackage, entry: Entry, file: string, roots: { domain: string; path: string }[]): void {
  const directory = dirname(file);
  const path = /\/(?:index|entry)\.[cm]?tsx?$/.test(file) && directory !== join(pkg.directory, 'src')
    ? directory : file;
  roots.push({ domain: entry.domain, path });
  const subtree = file.replace(/\.[cm]?tsx?$/, '');
  if (existsSync(subtree) && statSync(subtree).isDirectory()) roots.push({ domain: entry.domain, path: subtree });
}

function addEntryRoots(pkg: SourcePackage, entries: Entry[], roots: { domain: string; path: string }[]): void {
  for (const entry of entries) {
    if (entry.domain === '$aggregate') continue;
    for (const file of entry.files) {
      addFileRoots(pkg, entry, file, roots);
    }
  }
}

function loadPackages(root: string): Package[] {
  return sourcePackages({ packagesDir: join(root, 'packages') }).map(pkg => {
    const manifest = pkg.manifest as Manifest;
    const entries = exportEntries(pkg);
    const config = manifest.jini?.isolation;
    const roots = Object.entries(config?.domains ?? {}).flatMap(([domain, paths]) =>
      paths.map(path => ({ domain, path: resolve(pkg.directory, path) })));
    addEntryRoots(pkg, entries, roots);
    return {
      ...pkg, manifest, entries, roots: roots.sort((a, b) => b.path.length - a.path.length),
      shared: ['src/core', 'src/contracts', ...(config?.shared ?? [])].map(path => resolve(pkg.directory, path))
    };
  });
}
function owner(file: string, pkg: Package): string | undefined {
  const core = join(pkg.directory, 'src/core');
  const contracts = join(pkg.directory, 'src/contracts');
  const explicitShared = pkg.shared.filter(path => path !== core && path !== contracts);
  if (explicitShared.some(path => inside(file, path)) || inside(file, contracts)) return 'core';
  // A named adapter/domain nested under core (e.g. agentic/core/dom) is not made
  // shared merely by its physical location. The most specific public owner wins.
  const declared = pkg.roots.find(root => inside(file, root.path));
  return declared?.domain ?? (inside(file, core) ? 'core' : undefined);
}
function resolvePackageImport(specifier: string, packages: Map<string, Package>): string[] {
  const name = packageName(specifier);
  const pkg = packages.get(name);
  if (!pkg) return [];
  const key = specifier === name ? '.' : '.' + specifier.slice(name.length);
  return pkg.entries.find(entry => entry.subpath === key)?.files ?? [];
}

function forbiddenImports(pkg: Package, entry: Entry): string[] | undefined {
  const restrictions = pkg.manifest.jini?.isolation?.forbidden;
  return restrictions?.[entry.subpath] ?? restrictions?.[pkg.manifest.jini?.entries?.[entry.subpath] ?? ''];
}

/** Top-level mutation or I/O requires review even when package.json claims side-effect freedom.
 * Function/class bodies do not run on import; CLI main guards are deliberately explicit.
 * Module-local allocations (contexts, tokens, frozen catalogs) have no external effect.
 */
function moduleEffects(file: string): string[] {
  const source = parseSource({ file, source: readFileSync(file, 'utf8') });
  const effects: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return;
    if (ts.isIfStatement(node) && node.expression.getText(source) === 'isMainModule') return;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (/(?:^|\.)(?:register|listen|connect|setInterval|setTimeout|readFileSync|writeFileSync|mkdirSync|exit|chdir|log|error|warn)$/.test(name))
        effects.push(`line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${name}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return effects;
}

/**
 * Computes each source closure once per entry with cached import extraction.
 * O(entries × reachable edges), O(source files + closure output) space. No modules execute.
 * Files and bare dependencies are retained as evidence for the report and install rule.
 */
export function auditSubpathIsolation(
  required: { repoRoot: string } = { repoRoot: REPO_ROOT },
  _optional: Record<string, never> = {},
): SubpathIsolationAudit {
  const root = required.repoRoot;
  const packages = loadPackages(root);
  const owners = [...packages].sort((a, b) => b.directory.length - a.directory.length);
  const fileOwners = new Map<string, Package | undefined>();
  const byName = new Map(packages.map(pkg => [pkg.manifest.name, pkg]));
  const imports = new Map<string, ImportRef[]>();
  const effects = new Map<string, string[]>();
  const closures: SubpathClosure[] = [];
  const findings: IsolationFinding[] = [];
  const seenFindings = new Set<string>();
  function add(pkg: Package, entry: string, kind: IsolationFinding['kind'], file: string, reason: string): void {
    const finding = {
      package: pkg.manifest.name, subpath: entry, kind,
      rule: `SI-${kind === 'a' ? 'domain' : kind === 'b' ? 'dependency' : kind}`,
      file: relative(root, file).split('\\').join('/'), reason
    };
    const key = JSON.stringify(finding);
    if (!seenFindings.has(key)) { findings.push(finding); seenFindings.add(key); }
  }
  function resolveRelativeRuntimeImport(pkg: Package, entry: Entry, file: string, ref: ImportRef): string[] {
    let resolved: string[] = [];
    const target = sourceFile(resolve(dirname(file), ref.specifier));
    if (target) resolved = [target];
    else if (/\.(?:[cm]?js|jsx|tsx?|mts|cts)$/.test(ref.specifier))
      add(pkg, entry.subpath, 'resolution', file, `${entry.subpath}: cannot resolve ${ref.specifier}`);
    return resolved;
  }

  function resolveRuntimeImport(pkg: Package, entry: Entry, file: string, ref: ImportRef, dependencies: Set<string>): string[] {
    let resolved: string[] = [];
    if (ref.specifier.startsWith('.')) return resolveRelativeRuntimeImport(pkg, entry, file, ref);
    if (!ref.specifier.startsWith('node:') && !ref.specifier.startsWith('#')) {
      dependencies.add(packageName(ref.specifier));
      if (ref.specifier.startsWith('@jini-ai/')) {
        resolved = resolvePackageImport(ref.specifier, byName);
        if (!resolved.length) add(pkg, entry.subpath, 'resolution', file,
          `${entry.subpath}: no source export for ${ref.specifier}`);
      }
    }
    return resolved;
  }

  function enqueueTargets(pkg: Package, entry: Entry, file: string, ref: ImportRef, resolved: string[], pending: string[]): void {
    for (const target of resolved) {
      const domain = inside(target, pkg.directory) ? owner(target, pkg) : undefined;
      const sourceDomain = inside(file, pkg.directory) ? owner(file, pkg) : undefined;
      // Report the boundary crossing, not every internal edge after entering a sibling.
      if (entry.domain !== '$aggregate' && domain && domain !== 'core' && domain !== entry.domain
        && sourceDomain !== domain)
        add(pkg, entry.subpath, 'a', file,
          `${entry.subpath} (${entry.domain}) reaches ${relative(pkg.directory, target)} (${domain}) via ${ref.specifier}`);
      pending.push(target);
    }
  }

  function checkForbiddenImport(pkg: Package, entry: Entry, file: string, ref: ImportRef): void {
    const banned = forbiddenImports(pkg, entry);
    if (banned?.some(spec => spec.endsWith(':') ? ref.specifier.startsWith(spec)
      : ref.specifier === spec || ref.specifier.startsWith(`${spec}/`)))
      add(pkg, entry.subpath, 'a', file, `${entry.subpath}: forbidden runtime import ${ref.specifier}`);
  }

  function auditFile(pkg: Package, entry: Entry, file: string, dependencies: Set<string>, pending: string[]): void {
    const refs = imports.get(file) ?? extractImports(file);
    imports.set(file, refs);
    // Only this package's own source gets attributed to it; dependencies have their
    // own package audit. Cache per file even when several entries reach that module.
    if (inside(file, pkg.directory)) {
      const initializers = effects.get(file) ?? moduleEffects(file);
      effects.set(file, initializers);
      for (const effect of initializers) add(pkg, entry.subpath, 'c', file, `module top-level effect: ${effect}`);
    }
    for (const ref of refs) {
      if (ref.typeOnly) continue;
      checkDefaultLoad(pkg, entry, file, ref);
      const resolved = resolveRuntimeImport(pkg, entry, file, ref, dependencies);
      enqueueTargets(pkg, entry, file, ref, resolved, pending);
      checkForbiddenImport(pkg, entry, file, ref);
    }
  }

  function checkAggregate(pkg: Package, entry: Entry, visited: Set<string>): void {
    if (entry.domain === '$aggregate') {
      const domains = new Set([...visited].filter(file => inside(file, pkg.directory))
        .map(file => owner(file, pkg)).filter(domain => domain && domain !== 'core'));
      if (domains.size > 1) add(pkg, entry.subpath, 'd', entry.files[0]!,
        `${entry.subpath} is an aggregate barrel for ${[...domains].sort().join(', ')}; independent subpaths must stand alone`);
    }
  }

  function auditEntry(pkg: Package, entry: Entry): SubpathClosure {
    if (!entry.files.length) add(pkg, entry.subpath, 'resolution', join(pkg.directory, 'package.json'),
      `${entry.subpath}: no source file for ${entry.target}`);
    const visited = new Set<string>();
    const dependencies = new Set<string>();
    const pending = [...entry.files];
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      if (!/\.(?:[cm]?tsx?|[cm]?js|jsx)$/.test(file)) continue;
      auditFile(pkg, entry, file, dependencies, pending);
    }
    const closure = {
      package: pkg.manifest.name, subpath: entry.subpath, domain: entry.domain,
      files: [...visited].map(file => relative(root, file).split('\\').join('/')).sort(),
      dependencies: [...dependencies].sort()
    };
    closures.push(closure);
    checkAggregate(pkg, entry, visited);
    return closure;
  }

  /** Subset-only installation is not a correctness failure. Required dependencies stay required.
   * Opt-in ownership, rather than the fraction of exports using a library, governs optionality. */
  function checkOptionalPeers(pkg: Package): void {
    if (pkg.manifest.private) return;
    for (const reason of optionalPeerContractProblems({ manifest: pkg.manifest }))
      add(pkg, '(all)', 'optional-peer', join(pkg.directory, 'package.json'), reason);
  }
  /** The public subpath is the opt-in boundary. Deferred default loads still need installation.
   * Owner lookup is cached per file: O(1) after the first O(packages) lookup, O(files) space. */
  function checkDefaultLoad(pkg: Package, entry: Entry, file: string, ref: ImportRef): void {
    if (entry.subpath !== '.') return;
    if (!fileOwners.has(file)) fileOwners.set(file, owners.find(candidate => inside(file, candidate.directory)));
    const ownerPackage = fileOwners.get(file);
    if (!ownerPackage) return;
    const name = packageName(ref.specifier);
    if (ownerPackage.manifest.peerDependenciesMeta?.[name]?.optional !== true) return;
    add(pkg, entry.subpath, 'optional-peer', file,
      `default path ${pkg.manifest.name}${entry.subpath} reaches optional peer ${name}; a default feature needs a required dependency`);
  }

  for (const pkg of packages) {
    checkOptionalPeers(pkg);
    if (!pkg.entries.length) continue;
    for (const entry of pkg.entries) auditEntry(pkg, entry);
    if (pkg.manifest.sideEffects !== false) add(pkg, '(all)', 'c', join(pkg.directory, 'package.json'),
      Array.isArray(pkg.manifest.sideEffects) ? `sideEffects is an asset allowlist (${pkg.manifest.sideEffects.join(', ')}); retain CSS effects, JS must stay isolated`
        : 'missing sideEffects: false; inspect module initialization before marking JS side-effect free');
  }
  return { closures, findings };
}

/** Fails cross-domain loading, invalid optional-peer contracts, default optional loads and unresolved edges. */
export function checkSubpathIsolation(
  required: { repoRoot: string } = { repoRoot: REPO_ROOT },
  optional: Record<string, never> = {},
): Violation[] {
  return auditSubpathIsolation(required, optional).findings.filter(finding =>
    finding.kind === 'a' || finding.kind === 'b' || finding.kind === 'resolution' || finding.kind === 'optional-peer')
    .map(({ rule, file, reason }) => ({ rule, file, reason }));
}
