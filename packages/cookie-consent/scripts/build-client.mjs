/** Build-time only: bundles the browser client into dependency-free IIFEs and checks their weight.
 * Runs after `tsc` (it reads dist/render for banner.css). Paths go through node:path for Windows. */
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** Gzip budget (bytes). The design debate's target was ~3 KB; the measured P1 build is ~4.4 KB, so this
 * ceiling only stops further growth. See README "Size". */
const BUNDLES = [{ entry: 'entry.ts', out: 'client.min.js', budget: 4608 }];

let over = false;
for (const { entry, out, budget } of BUNDLES) {
  const outfile = path.join(root, 'dist', out);
  const result = await build({
    entryPoints: [path.join(root, 'src', 'client', entry)],
    bundle: true, minify: true, format: 'iife', target: 'es2020', platform: 'browser',
    legalComments: 'none', write: false, outfile,
  });
  const code = result.outputFiles[0].contents;
  const gzipped = gzipSync(code, { level: 9 }).length;
  await writeFile(outfile, code);
  console.log(`${out}: ${code.length} bytes, ${gzipped} bytes gzipped (budget ${budget})`);
  if (gzipped > budget) { console.error(`${out} is over its gzip budget`); over = true; }
}
const { BASE_CSS, parityCss } = await import(pathToFileURL(path.join(root, 'dist', 'render', 'index.js')).href);
await writeFile(path.join(root, 'dist', 'banner.css'), BASE_CSS + parityCss({ colors: null }));
if (over) process.exit(1);
