import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const candidateDir = process.argv[2];
const archives = new Set(readdirSync(candidateDir).filter(n => n.endsWith('.tgz')).map(n => resolve(candidateDir, n)));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.ok(lock.packages['node_modules/@jini-ai/cms-forms'], 'Nested CMS forms must be installed from the candidate');
let n = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.split('node_modules/').at(-1).startsWith('@jini-ai/')) continue;
  n++;
  assert.notEqual(entry.link, true, `${path} must not be a workspace link`);
  assert.match(entry.resolved, /^file:/, `${path} must resolve to a local candidate archive`);
  assert.ok(archives.has(resolve(entry.resolved.slice(5))), `${path} must resolve to an archive from this candidate`);
  assert.equal(entry.version, '0.7.3-next.2', `${path} version`);
}
console.log('lock entries @jini-ai:', n);
await import('@jini-ai/cms/presentation/html');
await import('@jini-ai/agent-plugins/cloudflare/lib/forms.mjs');
const a = await import('@jini-ai/cms/taxonomy/render-entry');
const b = await import('@jini-ai/cms/forms/field-length-caps');
const c = await import('@jini-ai/cms/widgets/html/media-html');
console.log('w4 packed imports:', typeof a.renderHtmlTaxonomy, typeof b.fieldMaxChars, typeof c.renderMediaRawHtml);
