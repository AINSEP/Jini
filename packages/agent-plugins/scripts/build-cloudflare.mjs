/** A copied Cloudflare payload must carry its declared CMS runtime dependency, independently of
 * the host's node_modules ancestry. Source tests still exercise the unbundled package imports. */
import { build } from 'esbuild';
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/cloudflare');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'cloudflare'), output, { recursive: true, filter: source => path.basename(source) !== '__tests__' });
await build({
  entryPoints: [path.join(root, 'cloudflare/lib/forms.mjs')],
  outfile: path.join(output, 'lib/forms.mjs'), bundle: true, platform: 'node', format: 'esm',
  plugins: [{
    name: 'portable-validator-payload',
    setup(builder) {
      builder.onLoad({ filter: /cloudflare\/lib\/forms\.mjs$/ }, async ({ path: source }) => ({
        // import.meta.resolve is evaluated by Node at runtime, outside esbuild's import graph.
        // The receiver's portable validator is a separately emitted, self-contained payload.
        contents: (await readFile(source, 'utf8')).replace(
          "new URL(import.meta.resolve('@jini-ai/cms/forms/portable-validation'))",
          "new URL('../worker/portable-validation.mjs', import.meta.url)",
        ), loader: 'js', resolveDir: path.dirname(source),
      }));
    },
  }],
});
await build({
  entryPoints: [fileURLToPath(import.meta.resolve('@jini-ai/cms/forms/portable-validation'))],
  outfile: path.join(output, 'worker/portable-validation.mjs'), bundle: true, platform: 'neutral', format: 'esm',
});
