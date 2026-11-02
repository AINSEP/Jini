import assert from 'node:assert/strict';
import test from 'node:test';
import workers from '../cloudflare-workers.mjs';
import pages from '../cloudflare-pages.mjs';
import { fixture, credential, json, routes } from '../../lib/__tests__/fixture.mjs';
import { fakeD1 } from '../../lib/__tests__/d1-fake.mjs';

const SECRET = 'k'.repeat(43);
const files = [{ file: 'index.html', data: '<form data-form-slug="waitlist" action="/forms/waitlist/submit"></form>', contentType: 'text/html' }];
const formDestination = { forms: [{ slug: 'waitlist', fields: [{ name: 'email', required: true }] }], secret: SECRET };

function workersHosting({ d1, scripts }) {
  return routes([
    ['/workers/subdomain', null, () => json({ subdomain: 'my-account' })],
    ['/assets-upload-session', null, () => json({ jwt: 'session', buckets: [] })],
    [/\/d1\/database\/db-1\/query$/, 'POST', ({ init }) => json(d1.rest(JSON.parse(init.body)))],
    ['/d1/database', 'GET', () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }])],
    ['/workers/scripts/jini-demo', 'PUT', ({ init }) => { scripts.push(init.body); return json({ id: 'version' }); }],
    ['/subdomain', 'POST', () => json({ enabled: true })],
    ['/workers/scripts', 'GET', () => json([])],
  ]);
}

test('Workers with active forms provisions D1 and uploads the receiver on the same script', async () => {
  const d1 = fakeD1({ migrated: false });
  const scripts = [];
  const f = fixture({ respond: workersHosting({ d1, scripts }) });
  const result = await workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { formDestination } });
  const metadata = JSON.parse(scripts[0].get('metadata'));
  assert.deepEqual(metadata.bindings, [{ type: 'assets', name: 'ASSETS' }, { type: 'd1', name: 'TOVU_FORMS', id: 'db-1' }, { type: 'secret_text', name: 'TOVU_FORMS_SECRET', text: SECRET }]);
  assert.deepEqual(metadata.assets.config.run_worker_first, ['/forms/*', '/_tovu/*', '/'], 'the page holding the form runs the Worker first');
  assert.equal(metadata.main_module, 'index.mjs');
  assert.match(await scripts[0].get('forms-manifest.mjs').text(), /"slug":"waitlist"/);
  assert.match(await scripts[0].get('receiver.mjs').text(), /handleRequest/);
  assert.deepEqual(result.providerMetadata.formSubmissions, { forms: 1, databaseId: 'db-1', databaseName: 'tovu-forms-jini-demo' });
  assert.equal(JSON.stringify(result).includes(SECRET), false, 'the receiver key never enters publish history');
  const d1Index = f.calls.findIndex(call => call.url.includes('/d1/'));
  const sessionIndex = f.calls.findIndex(call => call.url.includes('assets-upload-session'));
  assert.ok(d1Index >= 0 && d1Index < sessionIndex, 'storage exists before the script that binds it');
});

test('Workers without forms keeps the assets-only script; Pages ignores forms', async () => {
  const scripts = [];
  const f = fixture({ respond: workersHosting({ d1: fakeD1(), scripts }) });
  const result = await workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { formDestination: { forms: [] } } });
  assert.deepEqual(JSON.parse(scripts[0].get('metadata')).bindings, [{ type: 'assets', name: 'ASSETS' }]);
  assert.equal(JSON.parse(scripts[0].get('metadata')).assets.config.run_worker_first, undefined);
  assert.equal(result.providerMetadata.formSubmissions, undefined);
  assert.equal(f.calls.some(call => call.url.includes('/d1/')), false);
  const p = fixture({ respond: routes([
    ['/pages/projects/jini-demo', null, () => json({ name: 'jini-demo' })],
    ['/upload-token', null, () => json({ jwt: 'upload' })],
    ['/check-missing', null, () => json([])],
    ['/upsert-hashes', null, () => json({})],
    ['/deployments', null, () => json({ id: 'deployment' })],
  ]) });
  const published = await pages.create({ credential, config: {}, kit: p.kit }).publish({ files, projectName: 'demo', metadata: { formDestination: { forms: formDestination.forms } } });
  assert.equal(published.providerMetadata.formSubmissions, undefined);
});

test('Workers with forms but no receiver key refuses before any remote write', async () => {
  const f = fixture({ respond: workersHosting({ d1: fakeD1(), scripts: [] }) });
  await assert.rejects(workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { formDestination: { forms: formDestination.forms } } }), /CLOUDFLARE_FORMS_INVALID.*receiver key/);
  assert.equal(f.calls.some(call => (call.init.method ?? 'GET') !== 'GET'), false);
});

test('preview reports form submissions on Workers and the Pages limitation', async () => {
  const f = fixture({ respond: workersHosting({ d1: fakeD1(), scripts: [] }) });
  const inspected = await workers.preview({ credential, config: {}, kit: f.kit, projectName: 'demo', formDestination: { forms: formDestination.forms } });
  assert.equal(inspected.formSubmissions.status, 'on');
  assert.equal(inspected.formSubmissions.changes[0].action, 'reuse');
  const plain = await workers.preview({ credential, config: {}, kit: f.kit, projectName: 'demo' });
  assert.equal(plain.formSubmissions, undefined);
  const p = fixture({ respond: routes([['/pages/projects', 'GET', () => json([])]]) });
  const onPages = await pages.preview({ credential, config: {}, kit: p.kit, projectName: 'demo', formDestination: { forms: formDestination.forms } });
  assert.equal(onPages.formSubmissions.status, 'unsupported');
});
