/** Build-time bundling only. Installed artifacts require no package manager or vendor SDK peers. */
import { build, type Metafile } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isBuiltin } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import { ADAPTER_FILE, POSTHOG_SDK_INTEGRITY, SDK_FILE } from '../src/analytics-posthog/consent.js';

// Pack tests use the same pinned asset contract as the builder.
export { ADAPTER_FILE, POSTHOG_SDK_INTEGRITY, SDK_FILE } from '../src/analytics-posthog/consent.js';

interface CatalogEntry { readonly id: string; readonly version: string; readonly path: string }

async function owningPackage(required: { input: string }): Promise<string> {
  let directory = path.dirname(required.input);
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: string };
      if (manifest.name) return directory;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`No package license owner for ${required.input}`);
    directory = parent;
  }
}

interface BundledPackage { readonly root: string; readonly manifest: { name: string; version: string; license?: unknown; repository?: unknown }; readonly names: readonly string[] }

const repositoryOf = (manifest: BundledPackage['manifest']): string | undefined => {
  const value = typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository as { url?: unknown } | undefined)?.url;
  return typeof value === 'string' ? value.replace(/^git\+/, '').replace(/^git:/, 'https:').replace(/\.git$/, '') : undefined;
};

/** Reviewed upstream license text checked in under `license-supplements/<repository>/` (with a
 * `SOURCE` note) for packages whose repository ships none in its npm packages. */
async function supplementFor(required: { packageRoot: string; item: BundledPackage }): Promise<BundledPackage | undefined> {
  const repository = repositoryOf(required.item.manifest);
  if (!repository) return undefined;
  const root = path.join(required.packageRoot, 'license-supplements', repository.replace(/^https:\/\//, '').replace(/[^a-z0-9._-]/gi, '_'));
  const names = await readdir(root).catch(() => [] as string[]);
  if (!names.includes('LICENSE')) return undefined;
  return { root, manifest: { name: `${repository} (license supplement)`, version: 'reviewed' }, names: names.sort() };
}

/** Preserve each input package's license/notice texts, not only esbuild's legal-comment excerpts.
 * A package that ships no license file (some upstream monorepos omit it from sub-packages) takes the
 * text of a bundled sibling from the same repository with the same declared license; the copy is
 * recorded in `LICENSE-SOURCE`. Anything else still fails the build.
 * @complexity O(inputs × ancestor depth + packages² + license bytes) time; O(inputs + packages) metadata. */
async function retainLicenses(required: { packageRoot: string; destinationPackageRoot: string; artifactRoot: string; inputs: readonly string[] }, _optional = {}): Promise<void> {
  const roots = new Set<string>();
  for (const input of required.inputs) {
    const owner = await owningPackage({ input: path.resolve(required.packageRoot, input) });
    // Sources stay in the build workspace; the selected distribution owns their attribution.
    roots.add(owner === required.packageRoot ? required.destinationPackageRoot : owner);
  }
  const bundled: BundledPackage[] = [];
  for (const root of [...roots].sort()) {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as BundledPackage['manifest'];
    const files = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
    bundled.push({ root, manifest, names: files.filter(name => /^(?:licen[sc]e|copying|notice)(?:$|[.-])/i.test(name)).sort() });
  }
  for (const item of bundled) await retainPackageLicense({ ...required, bundled, item });
}

/** Copy a dependency's own license, a same-repository sibling's, or a reviewed supplement.
 * Fails closed when none exists. O(bundled packages + license bytes) time, O(license bytes) space. */
async function retainPackageLicense(required: { packageRoot: string; artifactRoot: string; bundled: readonly BundledPackage[]; item: BundledPackage }, _optional = {}): Promise<void> {
  const { item, bundled } = required;
  const sibling = item.names.length ? item : bundled.find(other => other.names.length && other.manifest.license === item.manifest.license
    && repositoryOf(other.manifest) !== undefined && repositoryOf(other.manifest) === repositoryOf(item.manifest))
    ?? await supplementFor({ packageRoot: required.packageRoot, item });
  if (!sibling) throw new Error(`Missing license text for bundled package ${item.manifest.name}`);
  const target = path.join(required.artifactRoot, 'licenses', item.manifest.name.replace(/[^a-z0-9._-]/gi, '_'));
  await mkdir(target, { recursive: true });
  for (const name of sibling.names) await copyFile(path.join(sibling.root, name), path.join(target, name));
  if (sibling !== item) await writeFile(path.join(target, 'LICENSE-SOURCE'), `License text copied from ${sibling.manifest.name}@${sibling.manifest.version} (same repository and declared license).\n`);
  // Not `package.json`: these are license records inside an artifact, never workspace packages.
  await writeFile(path.join(target, 'package-license.json'), JSON.stringify({ name: item.manifest.name, version: item.manifest.version, license: item.manifest.license }, null, 2) + '\n');
}

function assertSelfContained(required: { metafile: Metafile }): void {
  for (const output of Object.values(required.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path)) throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
    }
  }
}

/** The full no-external SDK (replay included) is copied byte for byte so its SHA-256 is the pinned one;
 * browsers request it same-origin only after a consent choice. The consent adapter is bundled for the browser.
 * @throws When the installed posthog-js file is not the pinned one. */
export async function addPostHogBrowserFiles(required: { packageRoot: string; destinationPackageRoot: string; artifactRoot: string }, _optional = {}): Promise<void> {
  const sdk = createRequire(path.join(required.packageRoot, 'package.json')).resolve('posthog-js/dist/module.full.no-external.js');
  const bytes = await readFile(sdk);
  if (`sha256-${createHash('sha256').update(bytes).digest('base64')}` !== POSTHOG_SDK_INTEGRITY) {
    throw new Error(`posthog-js file does not match the pinned digest: ${sdk}`);
  }
  await writeFile(path.join(required.artifactRoot, 'server', SDK_FILE), bytes);
  const adapter = await build({ absWorkingDir: required.packageRoot, entryPoints: [path.join(required.packageRoot, 'src/analytics-posthog/consent-adapter.ts')],
    outfile: path.join(required.artifactRoot, 'server', ADAPTER_FILE), bundle: true, platform: 'browser', format: 'esm', target: 'es2020',
    minify: true, metafile: true, legalComments: 'inline', sourcemap: false });
  assertSelfContained({ metafile: adapter.metafile });
  await retainLicenses({ ...required, inputs: [sdk, ...Object.keys(adapter.metafile.inputs)] });
}

/** Bundle the selected entry and browser assets, retain their licenses, then seal the staged manifest.
 * Build/validation failures propagate before publication. Work scales with selected inputs and retained bytes. */
async function buildArtifact(required: { packageRoot: string; destinationPackageRoot: string; staging: string; id: string; version: string }, _optional = {}): Promise<CatalogEntry> {
  const source = path.join(required.packageRoot, 'src', required.id);
  const manifest = JSON.parse(await readFile(path.join(source, 'jini.plugin.json'), 'utf8')) as { id: string; version: string; integrity: Record<string, string> };
  if (manifest.id !== required.id) throw new Error('Plugin directory and manifest id must agree');
  manifest.version = required.version;
  const relative = `plugins/${manifest.id}/${manifest.version}`;
  const artifactRoot = path.join(required.staging, relative);
  await mkdir(path.join(artifactRoot, 'server'), { recursive: true });
  const result = await build({
    absWorkingDir: required.packageRoot,
    entryPoints: [path.join(source, 'index.ts')], outfile: path.join(artifactRoot, 'server/index.mjs'),
    bundle: true, packages: 'bundle', platform: 'node', target: 'node24', format: 'esm',
    metafile: true, legalComments: 'inline', sourcemap: false,
    // Bundled CommonJS SDKs can require Node builtins; they must never resolve runtime npm deps.
    banner: { js: 'import { createRequire as __jiniCreateRequire } from "node:module"; const require = __jiniCreateRequire(import.meta.url);' },
  });
  assertSelfContained({ metafile: result.metafile });
  if (required.id === 'analytics-posthog') await addPostHogBrowserFiles({ ...required, artifactRoot });
  await retainLicenses({ ...required, artifactRoot, inputs: Object.keys(result.metafile.inputs) });
  // The existing installer owns exact-file hashing, including retained license files.
  manifest.integrity = await computePluginIntegrity({ sourceDir: artifactRoot });
  await writeFile(path.join(artifactRoot, 'jini.plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { id: manifest.id, version: manifest.version, path: relative };
}

/** Marks a failed rollback so cleanup cannot delete the only remaining completed payload. */
class PayloadRecoveryError extends AggregateError {}

/** Swap only a completed payload, restoring its predecessor if publication fails.
 * Filesystem errors propagate. O(1) renames; cleanup is owned by the caller. */
async function replacePayload(required: { staging: string; outputRoot: string }, _optional = {}): Promise<void> {
  const target = path.join(required.outputRoot, 'plugins');
  const backup = path.join(required.staging, 'previous-plugins');
  let replaced = false;
  try { await rename(target, backup); replaced = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try { await rename(path.join(required.staging, 'plugins'), target); }
  catch (error) {
    if (replaced) {
      try { await rename(backup, target); }
      catch (recoveryError) { throw new PayloadRecoveryError([error, recoveryError], `Restore the previous payload from ${backup} before retrying.`); }
    }
    throw error;
  }
}

/** Build exactly one source into a destination package's generated `plugins` payload.
 * No executable adapter barrel.
 * @param required Source workspace, plugin id, and reviewed destination package directory.
 * @param optional Scratch output override; version and first-party attribution still come from the destination.
 * @returns The installer-compatible versioned artifact path, relative to the output directory.
 * @throws On unsafe ids/versions, invalid manifests, unbundled imports, missing licenses or filesystem errors.
 * @complexity One selected bundle plus license scans and exact-file hashing; no sibling builds.
 * @example buildProviderPlugin({ packageRoot, id: 'fixture-provider', destinationPackageRoot });
 */
export async function buildProviderPlugin(required: { packageRoot: string; id: string; destinationPackageRoot: string }, optional: { outputRoot?: string } = {}): Promise<CatalogEntry> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(required.id)) throw new Error('Invalid plugin id');
  const packageRoot = path.resolve(required.packageRoot);
  const destinationPackageRoot = path.resolve(required.destinationPackageRoot);
  const { version } = JSON.parse(await readFile(path.join(destinationPackageRoot, 'package.json'), 'utf8')) as { version: string };
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i.test(version)) throw new Error('Invalid destination package version');
  const outputRoot = path.resolve(optional.outputRoot ?? destinationPackageRoot);
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(path.join(outputRoot, '.provider-build-'));
  let preserveStaging = false;
  try {
    const entry = await buildArtifact({ packageRoot, destinationPackageRoot, staging, id: required.id, version });
    await replacePayload({ staging, outputRoot });
    return entry;
  } catch (error) {
    preserveStaging = error instanceof PayloadRecoveryError;
    throw error;
  } finally { if (!preserveStaging) await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [id, destinationPackageRoot] = process.argv.slice(2);
  if (!id || !destinationPackageRoot) throw new Error('Usage: build.ts <plugin-id> <destination-package-dir>');
  await buildProviderPlugin({ packageRoot: fileURLToPath(new URL('..', import.meta.url)), id, destinationPackageRoot });
}
