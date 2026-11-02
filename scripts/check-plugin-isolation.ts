/** Packaging policy only: callers supply real tarball inventories and esbuild inputs.
 * Packing, integrity, installation and loading remain with their existing owners.
 */
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPluginPackageId, agentPluginPackages, type AgentPluginPackageRow } from './lib/agent-plugin-packages.js';

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
  /** Agent payload layout; defaults to the reviewed table. */
  readonly agentPluginPackages?: readonly AgentPluginPackageRow[];
  /** Whether `provider-plugins/src/<id>` exists; defaults to this checkout's sources. */
  readonly providerSourceExists?: (input: { id: string }) => boolean;
}

const documentation = new Set(['package.json', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md']);
const pluginReference = /@jini-ai\/(?:plugin-[a-z0-9-]+|provider-plugins)(?=$|[^a-z0-9-])/;
const neutralHelpers = new Set(['attribution.ts', 'telemetry-reporter.ts', 'trim-trailing-slashes.ts']);
// Agent payloads publish under `<name>/` (layout table); provider payloads under `plugins/<id>/`.
const agentPayloadSource = new RegExp(`(?:^|/)(?:plugin-[a-z0-9-]+|agent-plugins/(?:${agentPluginPackages.map(row => row.name).join('|')}))/`);
const providerSources = fileURLToPath(new URL('../packages/provider-plugins/src/', import.meta.url));
const checkoutProviderSourceExists = ({ id }: { id: string }) => existsSync(resolve(providerSources, id));

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

interface PayloadPolicy { ownId: string | undefined; ownNames: ReadonlySet<string>; roots: readonly string[]; pluginIds: ReadonlySet<string> }

/** Allowed payload roots for one package: each agent row it ships (`<name>/`), plus `plugins/<id>/`
 * when it has a provider source. A package with no agent rows keeps the provider-only layout. */
function payloadPolicy(
  required: { ownId: string | undefined; pluginIds: readonly string[] },
  optional: PluginIsolationPorts,
): PayloadPolicy {
  const rows = optional.agentPluginPackages ?? agentPluginPackages;
  const own = required.ownId === undefined ? [] : rows.filter(row => agentPluginPackageId(row) === required.ownId);
  const roots = own.map(row => `${row.name}/`);
  const providerSourceExists = optional.providerSourceExists ?? checkoutProviderSourceExists;
  if (required.ownId !== undefined && (own.length === 0 || providerSourceExists({ id: required.ownId }))) roots.push(`plugins/${required.ownId}/`);
  // Agent payload names count as plugin ids, so a package cannot carry another package's face.
  const pluginIds = new Set([...required.pluginIds, ...rows.map(row => row.name)]);
  return { ownId: required.ownId, ownNames: new Set([required.ownId ?? '', ...own.map(row => row.name)]), roots, pluginIds };
}

function assertPayloadPath(required: { owner: string; path: string; policy: PayloadPolicy }): void {
  const { owner, path, policy } = required;
  const segments = path.split('/');
  if (segments.some(segment => policy.pluginIds.has(segment) && !policy.ownNames.has(segment))) {
    throw new TypeError(`${owner}: another plugin's payload in ${path}`);
  }
  if (policy.ownId !== undefined) {
    if (policy.roots.some(root => path.startsWith(root))) {
      const providers = [...path.matchAll(/(?:^|\/)plugins\/([^/]+)/g)];
      if (providers.some(match => match[1] !== policy.ownId)) throw new TypeError(`${owner}: another plugin's payload in ${path}`);
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
 * @param optional Local-reference resolver, layout rows and provider-source ports; resolution errors propagate,
 *   absent results fail closed.
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
  const policy = payloadPolicy({ ownId, pluginIds }, optional);
  for (const input of packedPaths) {
    if (!input || input.endsWith('/')) continue;
    const path = packedPath({ path: input });
    if (documentation.has(path)) continue;
    if (catalog) {
      if (path === 'catalog.json') continue;
      throw new TypeError(`${manifest.name}: catalog must be metadata-only: ${path}`);
    }
    assertPayloadPath({ owner: manifest.name, path, policy });
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
    if (pluginReference.test(normalized) || agentPayloadSource.test(normalized)) {
      throw new TypeError(`${required.pluginId}: forbidden bundled source ${input}`);
    }
    const path = relative(sourceRoot, resolve(required.packageRoot, normalized)).replaceAll('\\', '/');
    // Inputs outside this source tree are dependencies; local shared helpers require explicit review.
    if (path.startsWith('../') || neutralHelpers.has(path)) continue;
    if (path.startsWith(`${required.pluginId}/`)) continue;
    throw new TypeError(`${required.pluginId}: forbidden bundled source ${input}`);
  }
}
