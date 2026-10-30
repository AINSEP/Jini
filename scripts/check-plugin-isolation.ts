/** Packaging policy only: callers supply real tarball inventories and esbuild inputs.
 * Packing, integrity, installation and loading remain with their existing owners.
 */
import { relative, resolve } from 'node:path';

const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const;
type DependencyField = typeof dependencyFields[number];
export type PluginIsolationManifest = {
  readonly name: string;
  readonly bundledDependencies?: readonly string[] | boolean;
  readonly bundleDependencies?: readonly string[] | boolean;
} & Partial<Record<DependencyField, Readonly<Record<string, string>>>>;
type Dependency = { name: string; specifier: string };
export interface PluginIsolationPorts {
  /** Resolve a file/link/workspace path through its target manifest, never its folder name. */
  readonly resolveLocalDependency?: (input: Dependency) => string | undefined;
}

const documentation = new Set(['package.json', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md']);
const pluginReference = /@jini-ai\/(?:plugin-[a-z0-9-]+|provider-plugins)(?=$|[^a-z0-9-])/;
const neutralHelpers = new Set(['attribution.ts', 'telemetry-reporter.ts', 'trim-trailing-slashes.ts']);

/** Reject aliases as well as declared names; unresolved local references fail closed. */
function assertDependency(
  required: Dependency & { owner: string },
  optional: PluginIsolationPorts = {},
): void {
  const { name, specifier, owner } = required;
  if (pluginReference.test(`${name} ${specifier}`)) {
    throw new TypeError(`${owner}: forbidden plugin dependency ${name}: ${specifier}`);
  }
  if (!/^(?:(?:file|link|portal):|workspace:[./])/.test(specifier)) return;
  const target = optional.resolveLocalDependency?.({ name, specifier });
  if (!target) throw new TypeError(`${owner}: unresolved local dependency ${name}: ${specifier}`);
  if (pluginReference.test(target)) throw new TypeError(`${owner}: forbidden local plugin dependency ${name}: ${target}`);
}

function assertDependencies(required: { manifest: PluginIsolationManifest }, optional: PluginIsolationPorts): void {
  const { manifest } = required;
  if (!manifest.name.startsWith('@jini-ai/plugin-')) return;
  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      assertDependency({ owner: manifest.name, name, specifier }, optional);
    }
  }
  for (const field of ['bundledDependencies', 'bundleDependencies'] as const) {
    const value = manifest[field];
    // `true` bundles declared dependencies, already inspected above; arrays can hide undeclared names.
    if (!Array.isArray(value)) continue;
    for (const name of value) assertDependency({ owner: manifest.name, name, specifier: '' }, optional);
  }
}

function packedPath(required: { path: string }): string {
  const path = required.path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '').replace(/^package\//, '');
  if (path.startsWith('/') || path.split('/').includes('..')) throw new TypeError(`Invalid packed path: ${required.path}`);
  return path;
}

function assertPayloadPath(required: { owner: string; path: string; ownId: string | undefined; pluginIds: ReadonlySet<string> }): void {
  const { owner, path, ownId, pluginIds } = required;
  const segments = path.split('/');
  if (segments.some(segment => pluginIds.has(segment) && segment !== ownId)) {
    throw new TypeError(`${owner}: another plugin's payload in ${path}`);
  }
  if (ownId !== undefined) {
    const prefix = ownId === 'ui-ux-design' ? `${ownId}/` : `plugins/${ownId}/`;
    if (path.startsWith(prefix)) {
      const providers = [...path.matchAll(/(?:^|\/)plugins\/([^/]+)/g)];
      if (providers.some(match => match[1] !== ownId)) throw new TypeError(`${owner}: another plugin's payload in ${path}`);
      return;
    }
    throw new TypeError(`${owner}: unexpected packed file ${path}`);
  }
  // Manifest markers also catch payloads for plugin IDs not yet present in the workspace inventory.
  if (/(?:^|\/)(?:jini\.plugin\.json|plugin\.json)$/.test(path)
    || /(?:^|\/)plugins\/[^/]+\/\d[^/]*\//.test(path)) {
    throw new TypeError(`${owner}: core package publishes plugin payload ${path}`);
  }
}

/** Enforce installation isolation using the packed manifest and actual tarball file list.
 * @param required Package manifest, tarball paths, and all standalone plugin IDs from workspace discovery.
 * @param optional Local-reference resolver port; resolution errors propagate, absent results fail closed.
 * @throws TypeError for forbidden dependencies, sibling payloads or core payload publication.
 * @complexity O(D + F × L) time, O(I + L) space for D dependencies, F paths of L segments, I plugin IDs.
 */
export function assertPluginPackageIsolation(
  required: { manifest: PluginIsolationManifest; packedPaths: readonly string[]; pluginIds: readonly string[] },
  optional: PluginIsolationPorts = {},
): void {
  const { manifest, packedPaths, pluginIds } = required;
  const catalog = manifest.name === '@jini-ai/plugin-catalog';
  let ownId: string | undefined;
  if (!catalog && manifest.name.startsWith('@jini-ai/plugin-')) ownId = manifest.name.slice('@jini-ai/plugin-'.length);
  assertDependencies({ manifest }, optional);
  const knownIds = new Set(pluginIds);
  for (const input of packedPaths) {
    if (!input || input.endsWith('/')) continue;
    const path = packedPath({ path: input });
    if (documentation.has(path)) continue;
    if (catalog) {
      if (path === 'catalog.json') continue;
      throw new TypeError(`${manifest.name}: catalog must be metadata-only: ${path}`);
    }
    assertPayloadPath({ owner: manifest.name, path, ownId, pluginIds: knownIds });
  }
}

/** Reject sibling provider sources in esbuild's full transitive input inventory.
 * @param required Selected ID, builder working directory and metafile input keys.
 * @throws TypeError for a source owned by another plugin or an unreviewed shared source.
 * @complexity O(B × L) time, O(L) space for B input paths of length L; no I/O.
 */
export function assertPluginBundleIsolation(
  required: { pluginId: string; packageRoot: string; inputs: readonly string[] },
  _optional: Record<string, never> = {},
): void {
  const sourceRoot = resolve(required.packageRoot, 'src');
  for (const input of required.inputs) {
    const normalized = input.replaceAll('\\', '/');
    if (pluginReference.test(normalized) || /(?:^|\/)(?:plugin-[a-z0-9-]+|ui-ux-design)\//.test(normalized)) {
      throw new TypeError(`${required.pluginId}: forbidden bundled source ${input}`);
    }
    const path = relative(sourceRoot, resolve(required.packageRoot, normalized)).replaceAll('\\', '/');
    // Inputs outside this source tree are dependencies; local shared helpers require explicit review.
    if (path.startsWith('../') || neutralHelpers.has(path)) continue;
    if (path.startsWith(`${required.pluginId}/`)) continue;
    throw new TypeError(`${required.pluginId}: forbidden bundled source ${input}`);
  }
}
