import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { databaseName, FORMS_BINDING, FORMS_SECRET_BINDING, FORMS_WORKER_ROUTES } from '../lib/forms.mjs';

// Moved from Tovu (content/agent-plugins/cloudflare/__tests__). Plugin-local: the folder walk below
// is what the assembler ships (tests excluded). Cases that drive the host's own deploy registry,
// credential-card parser, DNS adapter and lifecycle stay with the host.
const root = path.resolve(import.meta.dirname, '..');
const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the manifest keeps every frozen identifier hosts and saved sites already store', async () => {
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.name, 'cloudflare');
  const host = manifest.extensions.jini;
  assert.equal(host.id, 'tovu/cloudflare');
  assert.deepEqual(host.provides, ['deploy-target:cloudflare-workers', 'deploy-target:cloudflare-pages', 'form-destination:cloudflare-d1']);
  assert.deepEqual(host.supersedes.packages, ['cloudflare-pages']);
  assert.deepEqual(host.supersedes.contributions.map(row => [row.fromPlugins, row.descriptorId]), [[['deploy', 'cloudflare-pages'], 'cloudflare-pages']]);
  assert.deepEqual(host.credentialCards.map(card => card.target), ['cloudflare-workers', 'cloudflare-pages']);
  assert.deepEqual(host.publicDnsResolver, { url: 'https://cloudflare-dns.com/dns-query', format: 'dns-json' });
  assert.deepEqual((await readJson('mcp.json')).mcpServers, {});
});

test('every contribution file names a module this plugin ships', async () => {
  const files = await shippedFiles();
  const targets = (await readJson('tovu-deploy-targets.json')).targets;
  assert.deepEqual(targets.map(target => [target.id, target.module]), [
    ['cloudflare-workers', 'targets/cloudflare-workers.mjs'],
    ['cloudflare-pages', 'targets/cloudflare-pages.mjs'],
  ]);
  const destinations = (await readJson('tovu-form-destinations.json')).destinations;
  assert.deepEqual(destinations.map(row => [row.id, row.module, row.hosts]), [['cloudflare-d1', 'form-destinations/cloudflare-d1.mjs', ['cloudflare-workers']]]);
  for (const module of [...targets, ...destinations].map(row => row.module)) assert.ok(files.includes(module), module);
  assert.deepEqual((await readJson('tovu-consent.json')).contributions, [{ kind: 'region-resolver', id: 'cloudflare', header: 'cf-ipcountry' }]);
  assert.ok(files.includes('worker/forms-receiver.mjs'));
});

test('the distribution carries its CMS evidence reader without installing CMS at runtime', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, '../package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['@jini-ai/cms'], undefined);
  const source = await readFile(path.join(root, 'lib/cms-forms.mjs'), 'utf8');
  // A data URL has no package ancestry, matching the copied plugin payload.
  const { readSubmissionEvidence } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const evidence = { version: 1, schemaHash: 'a'.repeat(64), capturedAt: 'published', source: 'cloudflare', fields: [], consent: [] };
  assert.deepEqual(readSubmissionEvidence({ value: evidence }), evidence);
  assert.throws(() => readSubmissionEvidence({ value: { ...evidence, schemaHash: 'invalid' } }), /Invalid form submission evidence hash/);
});

test('form wire names stay frozen: live Workers and D1 databases already use them', () => {
  assert.equal(FORMS_BINDING, 'TOVU_FORMS');
  assert.equal(FORMS_SECRET_BINDING, 'TOVU_FORMS_SECRET');
  assert.deepEqual(FORMS_WORKER_ROUTES, ['/forms/*', '/_tovu/*']);
  assert.equal(databaseName({ resourceName: 'jini-demo' }), 'tovu-forms-jini-demo');
});

test('the shipped text and runtime messages are host-neutral', async () => {
  const manifest = await readJson('plugin.json');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  const prose = (await shippedFiles()).filter(file => /\.(md|mjs)$/.test(file));
  assert.ok(prose.length > 20);
  for (const file of prose) assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b/, file);
});
