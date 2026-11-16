/** What a module specifier names once the importing package's own aliases are applied, so the
 * injection rules classify the package a spec resolves to, not the prefix it was written with:
 * - package.json `imports` (`#name`, exact or one `*`, condition objects and arrays),
 * - dependency aliases (`"plat": "npm:@jini-ai/platform@1"`, `workspace:@jini-ai/platform@*`),
 * - tsconfig `paths` (with `extends`), whose targets are owned by the package directory they land in.
 * A spec with no alias is returned unchanged; a path target outside every package, or inside a
 * `node_modules`, is not a package edge.
 */
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { SourcePackage } from './package-sources.js';

export type SpecResolver = (spec: string) => string[];

type Conditions = string | null | Conditions[] | { [condition: string]: Conditions };

/** Every string target of an `imports` entry, through conditions and fallback arrays. */
function leaves(target: Conditions): string[] {
  if (typeof target === 'string') return [target];
  if (target === null) return [];
  return (Array.isArray(target) ? target : Object.values(target)).flatMap(leaves);
}

/** Exact key, else the one-`*` pattern with the longest prefix (Node and TypeScript agree). */
function matchPattern<T>(required: { map: Record<string, T>; spec: string }): { value: T; star: string } | undefined {
  const { map, spec } = required;
  if (Object.hasOwn(map, spec)) return { value: map[spec]!, star: '' };
  const key = Object.keys(map).filter(entry => {
    const [prefix, suffix, extra] = entry.split('*');
    return suffix !== undefined && extra === undefined && spec.startsWith(prefix!) && spec.endsWith(suffix) && spec.length >= entry.length - 1;
  }).sort((a, b) => b.indexOf('*') - a.indexOf('*'))[0];
  if (key === undefined) return undefined;
  const [prefix, suffix] = key.split('*');
  return { value: map[key]!, star: spec.slice(prefix!.length, spec.length - suffix!.length) };
}

function packageNameOf(spec: string): string {
  return spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
}

function tsconfigPaths(directory: string): { paths: Record<string, string[]>; base: string } | undefined {
  const file = join(directory, 'tsconfig.json');
  if (!existsSync(file)) return undefined;
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(`Cannot parse ${file}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  // No file enumeration: only the compiler options (paths, baseUrl, extends) are needed.
  const parsed = ts.parseJsonConfigFileContent(read.config, { ...ts.sys, readDirectory: () => [] }, directory);
  const { paths, baseUrl, pathsBasePath } = parsed.options as ts.CompilerOptions & { pathsBasePath?: string };
  return paths ? { paths, base: baseUrl ?? pathsBasePath ?? directory } : undefined;
}

export function createSpecResolver(required: { pkg: SourcePackage; packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): SpecResolver {
  const { pkg } = required;
  const manifest = pkg.manifest as SourcePackage['manifest'] & { imports?: Record<string, Conditions> };
  const owners = [...required.packages].sort((a, b) => b.directory.length - a.directory.length);
  const configured = tsconfigPaths(pkg.directory);
  const dependencies = { ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies, ...manifest.dependencies };

  /** The package that owns a resolved file path, as a spec; undefined outside every package. */
  function ownerSpec(path: string): string | undefined {
    if (path.split(sep).includes('node_modules')) return undefined;
    const owner = owners.find(candidate => path === candidate.directory || path.startsWith(candidate.directory + sep));
    return owner?.manifest.name;
  }
  function dependencyAlias(spec: string): string {
    const name = packageNameOf(spec);
    const real = /^(?:npm|workspace):((?:@[\w.-]+\/)?[\w][\w.-]*)@/.exec(`${dependencies[name] ?? ''}@`)?.[1];
    return real && real !== name ? real + spec.slice(name.length) : spec;
  }
  function viaPath(spec: string): string[] | undefined {
    const match = configured && matchPattern({ map: configured.paths, spec });
    if (!match) return undefined;
    return match.value.flatMap(target => ownerSpec(resolve(configured.base, target.replace('*', match.star))) ?? []).map(name =>
      name === packageNameOf(spec) ? spec : name);
  }
  function viaImports(spec: string): string[] {
    const match = manifest.imports && matchPattern({ map: manifest.imports, spec });
    if (!match) return [spec];
    return leaves(match.value).map(target => target.replace('*', match.star)).flatMap(target => target.startsWith('.')
      ? ownerSpec(resolve(pkg.directory, target)) ?? []
      : resolveBare(target));
  }
  function resolveBare(spec: string): string[] {
    return viaPath(spec) ?? [dependencyAlias(spec)];
  }
  return spec => {
    if (spec.startsWith('#')) return viaImports(spec);
    if (spec.startsWith('.') || spec.startsWith('/')) return [spec];
    return resolveBare(spec);
  };
}
