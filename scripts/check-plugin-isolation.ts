/** Packaging policy only: callers supply real tarball inventories and esbuild inputs.
 * Packing, integrity, installation and loading remain with their existing owners.
 * Agent plugins ship as `@jini-ai/agent-plugins/<name>` subpaths: this gate proves each subpath
 * export reaches only its own folder and each folder publishes no tests and no sibling's payload;
 * `check-agent-plugin-content.ts` proves no folder's code imports a sibling folder.
 */
import { existsSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PLUGINS_PACKAGE, agentPluginExports, agentPluginPackages, isPublishedAgentPluginFile,
  type AgentPluginPackageRow,
} from './lib/agent-plugin-packages.js';

const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const;
type DependencyField = typeof dependencyFields[number];
export type PluginIsolationManifest = {
  readonly name: string;
  readonly bundledDependencies?: readonly string[] | boolean;
  readonly bundleDependencies?: readonly string[] | boolean;
  readonly exports?: unknown;
  readonly files?: readonly string[];
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
// Agent payloads publish under `<name>/` of the agent-plugins package; provider payloads under `plugins/<id>/`.
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
  if (!manifest.name.startsWith('@jini-ai/plugin-') && manifest.name !== AGENT_PLUGINS_PACKAGE && manifest.name !== PROVIDER_PLUGINS_PACKAGE) return;
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

/** Payload policy for core libraries and private provider conformance fixtures. */
function payloadPolicy(
  required: { packageName: string; ownId: string | undefined; pluginIds: readonly string[] },
  optional: PluginIsolationPorts,
): PayloadPolicy {
  const rows = optional.agentPluginPackages ?? agentPluginPackages;
  const roots: string[] = [];
  const providerSourceExists = optional.providerSourceExists ?? checkoutProviderSourceExists;
  if (required.ownId !== undefined && providerSourceExists({ id: required.ownId })) roots.push(`plugins/${required.ownId}/`);
  // Agent payload names count as plugin ids, so a provider package cannot carry an agent face.
  const pluginIds = new Set([...required.pluginIds, ...rows.map(row => row.name)]);
  return { ownId: required.ownId, ownNames: new Set([required.ownId ?? '']), roots, pluginIds };
}

/** The path segments that would name a plugin payload. A plugin package is checked on every segment; a
 * core package only where a payload lives (its root folder or a `plugins/<id>` folder), so a library
 * folder such as `dist/render/` is not mistaken for the `render` plugin. */
function payloadSegments(required: { path: string; policy: PayloadPolicy }): string[] {
  const segments = required.path.split('/');
  if (required.policy.ownId !== undefined) return segments;
  return [segments[0] ?? '', ...[...required.path.matchAll(/(?:^|\/)plugins\/([^/]+)/g)].map(match => match[1] ?? '')];
}

function assertPayloadPath(required: { owner: string; path: string; policy: PayloadPolicy }): void {
  const { owner, path, policy } = required;
  if (payloadSegments({ path, policy }).some(segment => policy.pluginIds.has(segment) && !policy.ownNames.has(segment))) {
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
  assertNoPayloadMarker({ owner, path });
}

/** Manifest markers also catch payloads for plugin IDs not yet present in the workspace inventory. */
function assertNoPayloadMarker(required: { owner: string; path: string }): void {
  if (/(?:^|\/)(?:jini\.plugin\.json|plugin\.json)$/.test(required.path)
    || /(?:^|\/)plugins\/[^/]+\/\d[^/]*\//.test(required.path)) {
    throw new TypeError(`${required.owner}: core package publishes plugin payload ${required.path}`);
  }
}

/** A packed file of `@jini-ai/agent-plugins`: inside a row's folder it must be published content naming
 * no other plugin; outside every folder it is library code and may carry no plugin payload. */
function assertSubpathPayloadPath(required: { path: string; names: ReadonlySet<string>; pluginIds: ReadonlySet<string> }): void {
  const { path, names, pluginIds } = required;
  const [folder = '', ...rest] = path.split('/');
  if (!names.has(folder)) return assertNoPayloadMarker({ owner: AGENT_PLUGINS_PACKAGE, path });
  if (!isPublishedAgentPluginFile({ path: rest.join('/') })) throw new TypeError(`${AGENT_PLUGINS_PACKAGE}: unpublished file in ${path}`);
  if (rest.some(segment => pluginIds.has(segment) && segment !== folder)) {
    throw new TypeError(`${AGENT_PLUGINS_PACKAGE}: another plugin's payload in ${path}`);
  }
}

/** Each row's exports are exactly its own two subpaths, and no other export reaches into a plugin folder,
 * so resolving one subpath can never load another plugin's files. Runs on the source manifest (npm pack
 * copies `exports` unchanged).
 * @param required The `@jini-ai/agent-plugins` manifest.
 * @param optional Layout rows (default: the reviewed table).
 * @throws TypeError naming the first missing, altered or cross-folder export.
 * @complexity O(r + e) for r rows and e export keys. */
export function assertAgentPluginSubpathExports(
  required: { manifest: PluginIsolationManifest },
  optional: Pick<PluginIsolationPorts, 'agentPluginPackages'> = {},
): void {
  const rows = optional.agentPluginPackages ?? agentPluginPackages;
  const exports = (required.manifest.exports ?? {}) as Record<string, unknown>;
  const owners = new Set(rows.map(row => row.name));
  const expected: Record<string, unknown> = Object.assign({}, ...rows.map(row => agentPluginExports(row)));
  for (const row of rows) {
    for (const [key, target] of Object.entries(agentPluginExports(row))) {
      if (exports[key] !== target) throw new TypeError(`${AGENT_PLUGINS_PACKAGE}: export ${key} must be ${target}`);
    }
  }
  for (const [key, target] of Object.entries(exports)) {
    for (const leaf of exportTargets({ target })) {
      const folder = posix.normalize(decodeURIComponent(leaf).replaceAll('\\', '/')).split('/')[0] ?? '';
      if (owners.has(folder) && expected[key] !== target) throw new TypeError(`${AGENT_PLUGINS_PACKAGE}: export ${key} reaches into ${folder}/`);
    }
  }
}

/** Conditional exports and fallback arrays carry the same folder boundary as direct targets. */
function exportTargets({ target }: { target: unknown }, _optional: Record<string, never> = {}): string[] {
  if (typeof target === 'string') return [target];
  if (!target || typeof target !== 'object') return [];
  return Object.values(target).flatMap(value => exportTargets({ target: value }));
}

/** Every packed path of the agent-plugins package. */
function assertAgentPluginsPackage(
  required: { packedPaths: readonly string[]; pluginIds: readonly string[] },
  optional: PluginIsolationPorts,
): void {
  const rows = optional.agentPluginPackages ?? agentPluginPackages;
  const names = new Set(rows.map(row => row.name));
  const pluginIds = new Set([...required.pluginIds, ...names]);
  for (const input of required.packedPaths) {
    if (!input || input.endsWith('/')) continue;
    const path = packedPath({ path: input });
    if (!documentation.has(path)) assertSubpathPayloadPath({ path, names, pluginIds });
  }
}

/** Every provider runtime ships here, each with its own `plugins/<id>/` folder and subpath. */
export const PROVIDER_PLUGINS_PACKAGE = '@jini-ai/provider-plugins';

/** Whether `<version>/licenses/<npm-package>/<file>` is a license record retained by the provider build
 * (license/notice/copying text, `LICENSE-SOURCE`, a supplement's `SOURCE` note, `package-license.json`). O(1). */
function isRetainedLicenseRecord(required: { rest: readonly string[] }): boolean {
  const { rest } = required;
  return rest.length === 4 && rest[1] === 'licenses'
    && /^(?:(?:licen[sc]e|copying|notice)(?:$|[.-][^/]*)|SOURCE|package-license\.json)$/i.test(rest[3] ?? '');
}

/** One packed path of the provider distribution: `catalog.json`, or a `plugins/<id>/` payload of a
 * reviewed provider source that has no package of its own and names no other plugin inside it. */
function assertProviderDistributionPath(required: {
  path: string; pluginIds: ReadonlySet<string>; providerSourceExists: (input: { id: string }) => boolean;
}): void {
  const { path, pluginIds } = required;
  if (documentation.has(path) || path === 'catalog.json') return;
  const [root, id = '', ...rest] = path.split('/');
  if (root !== 'plugins' || !required.providerSourceExists({ id })) throw new TypeError(`${PROVIDER_PLUGINS_PACKAGE}: unexpected packed file ${path}`);
  // `<version>/licenses/<npm-package>/<record>`: the folder is named after a bundled npm package
  // (`licenses/langfuse/`), which may equal an agent plugin name; only that segment is exempt, and
  // only for the license records build.ts writes there.
  const named = isRetainedLicenseRecord({ rest }) ? rest.filter((_, index) => index !== 2) : rest;
  if (named.some(segment => segment === 'plugins' || (pluginIds.has(segment) && segment !== id))) {
    throw new TypeError(`${PROVIDER_PLUGINS_PACKAGE}: another plugin's payload in ${path}`);
  }
}

/** Every packed path of the provider distribution; agent plugin names count as plugin ids, so no face rides along. */
function assertProviderPluginsPackage(
  required: { packedPaths: readonly string[]; pluginIds: readonly string[] },
  optional: PluginIsolationPorts,
): void {
  const providerSourceExists = optional.providerSourceExists ?? checkoutProviderSourceExists;
  const pluginIds = new Set([...required.pluginIds, ...(optional.agentPluginPackages ?? agentPluginPackages).map(row => row.name)]);
  for (const input of required.packedPaths) {
    if (input && !input.endsWith('/')) assertProviderDistributionPath({ path: packedPath({ path: input }), pluginIds, providerSourceExists });
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
  assertDependencies({ manifest }, optional);
  if (manifest.name === AGENT_PLUGINS_PACKAGE) return assertAgentPluginsPackage(required, optional);
  if (manifest.name === PROVIDER_PLUGINS_PACKAGE) return assertProviderPluginsPackage(required, optional);
  const catalog = manifest.name === '@jini-ai/plugin-catalog';
  let ownId: string | undefined;
  if (!catalog && manifest.name.startsWith('@jini-ai/plugin-')) ownId = manifest.name.slice('@jini-ai/plugin-'.length);
  const policy = payloadPolicy({ packageName: manifest.name, ownId, pluginIds }, optional);
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
