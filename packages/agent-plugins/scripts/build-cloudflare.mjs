/** Copied plugin payloads have no host dependency ancestry. Emit the declared CMS dependency's
 * two portable surfaces inside Cloudflare's existing payload; source and packed modules use them. */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  stdin: { contents: "export { readSubmissionEvidence } from '@jini-ai/cms/forms';", resolveDir: root },
  outfile: fileURLToPath(new URL('../cloudflare/lib/cms-forms.mjs', import.meta.url)),
  bundle: true, platform: 'neutral', format: 'esm',
});
await build({
  entryPoints: [fileURLToPath(import.meta.resolve('@jini-ai/cms/forms/portable-validation'))],
  outfile: fileURLToPath(new URL('../cloudflare/worker/portable-validation.mjs', import.meta.url)),
  bundle: true, platform: 'neutral', format: 'esm',
});
