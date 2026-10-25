/** Build-time bundling only. Installed artifacts require no package manager or vendor SDK peers. */
import { build, type Metafile } from 'esbuild';
import { isBuiltin } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';

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

/** Preserve each input package's license/notice texts, not only esbuild's legal-comment excerpts. */
async function retainLicenses(required: { packageRoot: string; artifactRoot: string; metafile: Metafile }): Promise<void> {
  const roots = new Set<string>();
  for (const input of Object.keys(required.metafile.inputs)) roots.add(await owningPackage({ input: path.resolve(required.packageRoot, input) }));
  for (const root of [...roots].sort()) {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: unknown };
    const names = (await readdir(root)).filter(name => /^(?:licen[sc]e|copying|notice)(?:$|[.-])/i.test(name));
    if (!names.length) throw new Error(`Missing license text for bundled package ${manifest.name}`);
    const target = path.join(required.artifactRoot, 'licenses', manifest.name.replace(/[^a-z0-9._-]/gi, '_'));
    await mkdir(target, { recursive: true });
    for (const name of names.sort()) await copyFile(path.join(root, name), path.join(target, name));
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, license: manifest.license }, null, 2) + '\n');
  }
}

function assertSelfContained(required: { metafile: Metafile }): void {
  for (const output of Object.values(required.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path)) throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
    }
  }
}

async function buildArtifact(required: { packageRoot: string; staging: string; id: string; version: string }): Promise<CatalogEntry> {
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
  await retainLicenses({ packageRoot: required.packageRoot, artifactRoot, metafile: result.metafile });
  // The existing installer owns exact-file hashing, including retained license files.
  manifest.integrity = await computePluginIntegrity({ sourceDir: artifactRoot });
  await writeFile(path.join(artifactRoot, 'jini.plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { id: manifest.id, version: manifest.version, path: relative };
}

/** Build all provider folders before replacing published artifacts. No executable adapter barrel.
 * @returns Catalog entries pointing to installer-compatible immutable-version folders.
 * @throws On unbundled npm dependencies, absent license text or invalid source layout.
 */
export async function buildProviderPlugins(required: { packageRoot: string }, optional: { outputRoot?: string } = {}): Promise<readonly CatalogEntry[]> {
  const outputRoot = optional.outputRoot ?? required.packageRoot;
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(path.join(outputRoot, '.provider-build-'));
  try {
    const { version } = JSON.parse(await readFile(path.join(required.packageRoot, 'package.json'), 'utf8')) as { version: string };
    const sources = (await readdir(path.join(required.packageRoot, 'src'), { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('__'));
    const catalog: CatalogEntry[] = [];
    for (const entry of sources.sort((a, b) => a.name.localeCompare(b.name))) catalog.push(await buildArtifact({ ...required, staging, id: entry.name, version }));
    await writeFile(path.join(staging, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    await rm(path.join(outputRoot, 'plugins'), { recursive: true, force: true });
    await rename(path.join(staging, 'plugins'), path.join(outputRoot, 'plugins'));
    await rename(path.join(staging, 'catalog.json'), path.join(outputRoot, 'catalog.json'));
    return catalog;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildProviderPlugins({ packageRoot: fileURLToPath(new URL('..', import.meta.url)) });
}
