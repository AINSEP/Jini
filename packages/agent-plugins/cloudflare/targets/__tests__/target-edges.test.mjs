import assert from 'node:assert/strict';
import test from 'node:test';
import workers from '../cloudflare-workers.mjs';
import pages from '../cloudflare-pages.mjs';
import { fixture, credential, json, inventory, routes } from '../../lib/__tests__/fixture.mjs';

const files = [{ file: 'index.html', data: '<h1>Hello</h1>', contentType: 'text/html' }];
/** Workers hosting steps after the upload session; the session row is supplied per test. */
const workersHosting = [
  ['/workers/subdomain', null, () => json({ subdomain: 'my-account' })],
  [/\/workers\/scripts\/[^/]+$/, 'PUT', () => json({ id: 'version' })],
  ['/subdomain', 'POST', () => json({ enabled: true })],
];

test('preview of an explicitly recorded Worker name reports update, workers.dev enablement and no domains key', async () => {
  const f = fixture({ respond: routes([['/workers/scripts', null, () => json([{ id: 'existing-worker' }])]], request => inventory(request)) });
  const result = await workers.preview({ credential, config: { resourceName: 'existing-worker' }, kit: f.kit, projectName: 'ignored' });
  assert.deepEqual(result, { resourceName: 'existing-worker', targetId: 'cloudflare-workers', hostingChanges: [
    { action: 'update', targetId: 'cloudflare-workers', resourceName: 'existing-worker' },
    { action: 'enable-workers-dev', targetId: 'cloudflare-workers', resourceName: 'existing-worker' },
  ] });
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});

test('a project label with no DNS-safe characters still gets the stable jini-site name', async () => {
  const f = fixture({ respond: request => inventory(request) });
  const result = await pages.preview({ credential, config: {}, kit: { ...f.kit, safeDnsLabel: raw => raw === '' ? '' : f.kit.safeDnsLabel(raw) }, projectName: '' });
  assert.equal(result.resourceName, 'jini-site');
  assert.deepEqual(result.hostingChanges, [{ action: 'create', targetId: 'cloudflare-pages', resourceName: 'jini-site' }]);
});

test('preview without a domain surfaces the hosting inventory refusal instead of an unknown-domain answer', async () => {
  const f = fixture({ respond: () => json(null, 403, { errors: [{ code: 10000, message: 'Authentication error' }] }) });
  await assert.rejects(pages.preview({ credential, config: {}, kit: f.kit, projectName: 'demo' }),
    { code: 'CLOUDFLARE_API_ERROR', status: 403, message: /pages\/projects.*HTTP 403.*Check the token permissions/ });
});

test('Pages treats an HTTP 409 project conflict as a concurrent create and reuses the project', async () => {
  let exists = false;
  const f = fixture({ respond: routes([
    ['/pages/projects/jini-demo', null, () => json({ name: 'jini-demo' }, exists ? 200 : 404)],
    // The 409 status alone classifies the race; the message carries no "already exists" wording.
    ['/pages/projects', 'POST', () => { exists = true; return json(null, 409, { errors: [{ code: 8000002, message: 'Conflict' }] }); }],
    ['/upload-token', null, () => json({ jwt: 'upload' })],
    ['/check-missing', null, () => json([])],
    ['/upsert-hashes', null, () => json({})],
    ['/deployments', null, () => json({ id: 'deployment' })],
  ]) });
  const result = await pages.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' });
  assert.equal(result.status, 'ready');
  assert.equal(f.calls.filter(call => call.url.endsWith('/pages/projects/jini-demo')).length, 2);
});

test('Pages project creation denied for a reason other than a conflict refuses before any upload', async () => {
  const f = fixture({ respond: routes([
    ['/pages/projects/jini-demo', null, () => json(null, 404, { errors: [{ code: 8000007, message: 'Project not found.' }] })],
    ['/pages/projects', 'POST', () => json(null, 403, { errors: [{ code: 10000, message: 'Authentication error' }] })],
  ]) });
  await assert.rejects(pages.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' }),
    { code: 'CLOUDFLARE_API_ERROR', status: 403, message: /POST \/accounts\/account\/pages\/projects failed \(HTTP 403\)/ });
  assert.deepEqual(f.calls.map(call => call.init.method ?? 'GET'), ['GET', 'POST']);
});

test('Workers refuses every malformed upload session shape before any script write', async () => {
  for (const session of [{ buckets: [] }, { jwt: 'session', buckets: {} }, { jwt: 'session', buckets: ['not-a-bucket'] }]) {
    const f = fixture({ respond: routes([['/assets-upload-session', null, () => json(session)], ...workersHosting]) });
    await assert.rejects(workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' }),
      { code: 'CLOUDFLARE_ASSET_BUCKET_INVALID', status: 502, message: /jini-demo returned an invalid upload session/ });
    assert.ok(f.calls.every(call => call.init.method !== 'PUT'));
  }
});

test('Workers free plan refuses 20,001 files before any request; paid plan accepts them', async () => {
  const many = Array.from({ length: 20_001 }, (_, index) => ({ file: `p/${index}.html`, data: String(index), contentType: 'text/html' }));
  const free = fixture({ respond: () => { throw new Error('No request after a local limit refusal'); } });
  await assert.rejects(workers.create({ credential, config: {}, kit: free.kit }).publish({ files: many, projectName: 'demo' }),
    { code: 'CLOUDFLARE_ASSET_COUNT_LIMIT', message: /20001 files exceed this destination's 20000-file limit/ });
  assert.equal(free.calls.length, 0);
  const paid = fixture({ respond: routes([['/assets-upload-session', null, () => json({ jwt: 'session', buckets: [] })], ...workersHosting]) });
  const result = await workers.create({ credential, config: { assetPlan: 'paid' }, kit: paid.kit }).publish({ files: many, projectName: 'demo' });
  assert.equal(result.status, 'ready');
  assert.equal(result.url, 'https://jini-demo.my-account.workers.dev');
});

test('checkReachability delegates the published URL to the host probe', async () => {
  const f = fixture({ respond: () => json({}) });
  const probed = [];
  const kit = { ...f.kit, checkDeploymentUrl: async url => { probed.push(url); return { reachable: false, status: 'link-delayed' }; } };
  assert.deepEqual(await workers.create({ credential, config: {}, kit }).checkReachability('https://jini-demo.my-account.workers.dev'), { reachable: false, status: 'link-delayed' });
  assert.deepEqual(probed, ['https://jini-demo.my-account.workers.dev']);
});

test('Workers destination config keeps only a recorded string resource name', () => {
  assert.deepEqual(workers.destinationConfig({ providerMetadata: { resourceName: 'existing-worker' } }), { resourceName: 'existing-worker' });
  assert.deepEqual(workers.destinationConfig({ providerMetadata: { resourceName: 42 } }), {});
  assert.deepEqual(workers.destinationConfig({}), {});
});

test('Pages preview requests per_page 10 for project and domain lists and per_page 50 for zones (Cloudflare caps)', async () => {
  const f = fixture({ respond: request => inventory(request, { projects: [{ name: 'jini-demo' }] }) });
  const result = await pages.preview({ credential, config: { customDomain: 'example.com' }, kit: f.kit, projectName: 'demo' });
  assert.notEqual(result.domains.inventoryStatus, 'unknown');
  const perPage = suffix => f.calls.map(call => new URL(call.url)).filter(url => url.pathname.endsWith(suffix)).map(url => url.searchParams.get('per_page'));
  assert.deepEqual([...new Set(perPage('/pages/projects'))], ['10']);
  assert.deepEqual(perPage('/pages/projects/jini-demo/domains'), ['10']);
  assert.deepEqual(perPage('/zones'), ['50']);
});
