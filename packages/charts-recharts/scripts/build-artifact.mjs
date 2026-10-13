/** Compile the private workspace into a standalone, reviewable directory; never an npm release. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RECHARTS_PROVIDER_ID, RECHARTS_KINDS } from '../dist/descriptor.js';

const packageRoot = new URL('../', import.meta.url);
const artifact = new URL('plugin/', packageRoot);
const packageJson = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
if (!packageJson.private) throw new Error('The chart provider workspace must stay private.');
await rm(artifact, { recursive: true, force: true });
await mkdir(new URL('client/', artifact), { recursive: true });
const result = await build({
  absWorkingDir: fileURLToPath(packageRoot), entryPoints: ['src/index.ts'], outfile: 'plugin/client/provider.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (Object.values(result.metafile.outputs).some((output) => output.imports.length > 0)) throw new Error('Browser provider must have no external imports.');
// CSS is already scoped; esbuild compiles its local palette import without pulling global UI CSS.
await build({ absWorkingDir: fileURLToPath(packageRoot), entryPoints: ['src/styles.css'], outfile: 'plugin/client/styles.css', bundle: true, minify: false });
const paths = ['client/provider.js', 'client/styles.css'];
const integrity = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, `sha256-${createHash('sha256').update(await readFile(new URL(path, artifact))).digest('hex')}`])));
await writeFile(new URL('manifest.json', artifact), JSON.stringify({
  id: 'charts-recharts', version: packageJson.version,
  browserProviders: [{ id: RECHARTS_PROVIDER_ID, kind: 'chart', contractVersion: 1, kinds: RECHARTS_KINDS, javascript: paths[0], stylesheet: paths[1] }], integrity,
}, null, 2) + '\n');
// Build-only review evidence, not a runtime asset. Hosts bundle only manifest.json and client/.
await writeFile(new URL('bundle-meta.json', artifact), JSON.stringify(result.metafile, null, 2) + '\n');
