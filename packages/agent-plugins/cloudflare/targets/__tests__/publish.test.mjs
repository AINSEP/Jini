import assert from 'node:assert/strict';
import test from 'node:test';
import workers from '../cloudflare-workers.mjs';
import pages from '../cloudflare-pages.mjs';
import { fixture, credential, json, inventory, routes } from '../../lib/__tests__/fixture.mjs';

const files = [{ file: 'index.html', data: '<h1>Hello</h1>', contentType: 'text/html' }];
/** An existing Pages project that accepts every hosting step. */
const pagesHosting = [
  ['/pages/projects/jini-demo', null, () => json({ name: 'jini-demo' })],
  ['/upload-token', null, () => json({ jwt: 'upload' })],
  ['/check-missing', null, () => json([])],
  ['/upsert-hashes', null, () => json({})],
  ['/deployments', null, () => json({ id: 'deployment' })],
];

test('Workers follows server buckets, uses upload JWT, completion JWT and config, never uploads root config files', async () => {
  const f = fixture({ respond: ({ url, init }) => {
    if (url.pathname.endsWith('/workers/subdomain')) return json({ subdomain: 'my-account' });
    if (url.pathname.endsWith('/assets-upload-session')) {
      const manifest = JSON.parse(init.body).manifest;
      assert.deepEqual(Object.keys(manifest), ['/index.html']);
      return json({ jwt: 'upload', buckets: [[], [manifest['/index.html'].hash]] });
    }
    if (url.pathname.endsWith('/workers/assets/upload')) {
      assert.equal(init.headers.Authorization, 'Bearer upload');
      assert.equal(url.searchParams.get('base64'), 'true');
      assert.equal([...init.body.values()].length, 1);
      return json({ jwt: 'completion' }, 201);
    }
    if (url.pathname.endsWith('/workers/scripts/jini-demo') && init.method === 'PUT') {
      const meta = JSON.parse(awaitTextNotNeeded(init.body.get('metadata')));
      assert.equal(meta.assets.jwt, 'completion');
      assert.equal(meta.assets.config._headers, '/*\n  X-Test: yes\n');
      assert.equal(meta.assets.config._redirects, '/old /new 301');
      assert.deepEqual(meta.bindings, [{ type: 'assets', name: 'ASSETS' }]);
      return json({ id: 'version' });
    }
    if (url.pathname.endsWith('/subdomain') && init.method === 'POST') return json({ enabled: true });
    throw new Error(`Unexpected ${init.method} ${url}`);
  } });
  const target = workers.create({ credential, config: {}, kit: f.kit });
  const result = await target.publish({ files: [...files, { file: '_redirects', data: '/old /new 301' }], projectName: 'demo', responseHeaders: { 'X-Test': 'yes' } });
  assert.equal(result.status, 'ready');
  assert.equal(result.url, 'https://jini-demo.my-account.workers.dev');
  assert.equal(f.calls.filter(call => call.url.includes('/workers/assets/upload?')).length, 1);
});
function awaitTextNotNeeded(value) { assert.equal(typeof value, 'string'); return value; }

test('Workers empty buckets reuse the session JWT; unknown hashes and missing completion refuse', async () => {
  for (const mode of ['empty', 'unknown', 'incomplete']) {
    const sessionFor = ({ init }) => {
      const hash = JSON.parse(init.body).manifest['/index.html'].hash;
      return json({ jwt: 'session', buckets: { empty: [], unknown: [['unknown']], incomplete: [[hash]] }[mode] });
    };
    const f = fixture({ respond: routes([
      ['/workers/subdomain', null, () => json({ subdomain: 'my-account' })],
      ['/assets-upload-session', null, sessionFor],
      ['/workers/assets/upload', null, () => json({})],
      [/./, 'PUT', ({ init }) => { assert.equal(JSON.parse(init.body.get('metadata')).assets.jwt, 'session'); return json({ id: 'v' }); }],
      ['/subdomain', 'POST', () => json({})],
    ]) });
    const publish = workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' });
    if (mode === 'empty') assert.equal((await publish).status, 'ready');
    else await assert.rejects(publish, mode === 'unknown' ? /CLOUDFLARE_ASSET_BUCKET_INVALID/ : /CLOUDFLARE_UPLOAD_INCOMPLETE/);
  }
});

test('Workers missing subdomain guides setup and does not invent or create one', async () => {
  const f = fixture({ respond: () => json({}) });
  await assert.rejects(workers.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' }), /CLOUDFLARE_SUBDOMAIN_REQUIRED.*dashboard/);
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});

test('Pages keeps jini naming, hash dedup and headers/redirects form fields', async () => {
  let deployed;
  const f = fixture({ respond: ({ url, init }) => {
    if (url.pathname.endsWith('/pages/projects/jini-demo')) return json({ name: 'jini-demo' });
    if (url.pathname.endsWith('/upload-token')) return json({ jwt: 'upload' });
    if (url.pathname.endsWith('/check-missing')) return json(JSON.parse(init.body).hashes);
    if (url.pathname.endsWith('/assets/upload')) { assert.equal(JSON.parse(init.body).length, 1); return json({}); }
    if (url.pathname.endsWith('/upsert-hashes')) return json({});
    if (url.pathname.endsWith('/deployments')) { deployed = init.body; return json({ id: 'deployment' }); }
    throw new Error(`Unexpected ${url}`);
  } });
  const result = await pages.create({ credential, config: {}, kit: f.kit }).publish({ files: [...files, { ...files[0], file: 'copy.html' }, { file: '_redirects', data: '/old /new 301' }], projectName: 'demo', responseHeaders: { 'X-Test': 'yes' } });
  assert.equal(result.url, 'https://jini-demo.pages.dev');
  assert.equal(result.deploymentId, 'deployment');
  assert.deepEqual(Object.keys(JSON.parse(deployed.get('manifest'))), ['/index.html', '/copy.html']);
  assert.equal(await deployed.get('_headers').text(), '/*\n  X-Test: yes\n');
  assert.equal(await deployed.get('_redirects').text(), '/old /new 301');
});

test('domain request without a real human capability refuses before hosting mutations on BOTH targets', async () => {
  for (const module of [workers, pages]) {
    const f = fixture({ respond: request => inventory(request) });
    await assert.rejects(module.create({ credential, config: { customDomain: 'example.com' }, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { confirmed: true } }), /CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED/);
    assert.equal(f.calls.length, 0);
  }
});

test('Workers and Pages preview inventory is READ ONLY and discloses exact hosting/domain changes', async () => {
  for (const module of [workers, pages]) {
    const f = fixture({ respond: request => inventory(request, { projects: [{ name: 'jini-demo' }] }) });
    const result = await module.preview({ credential, config: { customDomain: 'example.com' }, kit: f.kit, projectName: 'demo' });
    assert.equal(result.resourceName, 'jini-demo');
    assert.equal(result.domains.inventoryStatus, 'complete');
    assert.equal(result.domains.hostnames.length, 2);
    assert.ok(result.hostingChanges.some(change => ['update', 'create'].includes(change.action)));
    assert.ok(f.calls.every(call => call.init.method === 'GET'));
  }
});

test('credential active status is separate from capability authorization; bad fields refuse safely', async () => {
  for (const [status, body, expected] of [[200, { status: 'active' }, true], [200, { status: 'disabled' }, false], [403, {}, false], [503, {}, false]]) {
    const f = fixture({ respond: () => json(body, status) });
    assert.equal((await workers.verifyCredential({ credential, kit: f.kit })).ok, expected);
    assert.ok(f.calls.every(call => call.url.endsWith('/accounts/account/tokens/verify') || call.url.endsWith('/user/tokens/verify')));
  }
  assert.match(workers.validateConfig({ assetPlan: 'invented' }), /assetPlan must be free or paid/);
  assert.equal(workers.validateConfig({ assetPlan: 'paid' }), null);
  const f = fixture({ respond: request => inventory(request) });
  await assert.rejects(workers.preview({ credential, config: { resourceName: '../wrong' }, kit: f.kit, projectName: 'demo' }), /CLOUDFLARE_RESOURCE_NAME/);
  assert.deepEqual(pages.destinationConfig({ providerMetadata: { resourceName: 'existing-project' } }), { resourceName: 'existing-project' });
  assert.deepEqual(pages.destinationConfig({}), {});
});

test('Pages project creation, lookup refusal, upload-token/missing-hash errors are specific', async () => {
  for (const mode of ['create', 'no-token', 'bad-hash', 'bad-list', 'denied']) {
    let exists = false;
    const missing = { 'bad-list': {}, 'bad-hash': ['unknown'] }[mode] ?? [];
    const f = fixture({ respond: routes([
      ['/pages/projects/jini-demo', null, () => mode === 'denied' ? json({}, 403) : json({ name: 'jini-demo' }, exists ? 200 : 404)],
      ['/pages/projects', 'POST', () => { exists = true; return json({ name: 'jini-demo' }); }],
      ['/upload-token', null, () => json(mode === 'no-token' ? {} : { jwt: 'upload' })],
      ['/check-missing', null, () => json(missing)],
      ['/upsert-hashes', null, () => json({})],
      ['/deployments', null, () => json({ id: 'deployment' })],
    ]) });
    const result = pages.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' });
    if (mode === 'create') assert.equal((await result).status, 'ready');
    else await assert.rejects(result, { code: { 'no-token': 'CLOUDFLARE_UPLOAD_TOKEN_REQUIRED', 'bad-hash': 'CLOUDFLARE_ASSET_BUCKET_INVALID', 'bad-list': 'CLOUDFLARE_ASSET_LOOKUP_INVALID', denied: 'CLOUDFLARE_API_ERROR' }[mode] });
  }
});

test('hosting ready plus unfinished custom domain never returns ready, with per-host state', async () => {
  const f = fixture({ respond: routes([
    ...pagesHosting,
    ['/domains', 'POST', ({ init }) => json({ name: JSON.parse(init.body).name, status: 'pending' })],
    ['/dns_records', 'POST', () => json({ id: 'dns' })],
    ['/domains/example.com', null, () => json({ status: 'active' })],
    ['/domains/www.example.com', null, () => json({ status: 'pending' })],
  ], request => inventory(request, { projects: [{ name: 'jini-demo' }] })) });
  const config = { customDomain: 'example.com' };
  const preview = await pages.preview({ credential, config, kit: f.kit, projectName: 'demo' });
  const result = await pages.create({ credential, config, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { domainApproval: { plan: preview.domains, authorize: async () => true } } });
  assert.equal(result.status, 'link-delayed');
  assert.deepEqual(result.providerMetadata.hostnames.map(host => host.status), ['ready', 'pending']);
  assert.equal(result.providerMetadata.hosting.status, 'ready');
  assert.match(result.statusMessage, /custom domains are unfinished/);
  assert.ok(result.providerMetadata.domainChanges.length > 0);
});

test('Workers requires explicit compatibility; historical vendor and Pages grants cannot expand', () => {
  assert.equal(workers.acceptsCredential({ worksFor: ['cloudflare'] }), false);
  assert.equal(workers.acceptsCredential({ worksFor: ['cloudflare-pages'] }), false);
  assert.equal(workers.acceptsCredential({ worksFor: ['cloudflare-workers'] }), true);
  assert.deepEqual(workers.defaultCredentialWorksFor, ['cloudflare-workers']);
});

test('metadata-only custom-domain requests cannot be silently ignored as ready hosting', async () => {
  const f = fixture({ respond: () => { throw new Error('No request before human review'); } });
  await assert.rejects(pages.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { customDomain: 'example.com', confirmed: true } }), /CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED.*example.com/);
  assert.equal(f.calls.length, 0);
});

test('a refused cutover remains partial even when hosting AND both HTTPS probes report ready', async () => {
  const f = fixture({ respond: request => {
    const { url, init } = request;
    if (init.method === 'DELETE') return json(null, 403);
    if (url.pathname.endsWith('/pages/projects/jini-demo')) return json({ name: 'jini-demo' });
    if (url.pathname.endsWith('/upload-token')) return json({ jwt: 'upload' });
    if (url.pathname.endsWith('/check-missing')) return json([]);
    if (url.pathname.endsWith('/upsert-hashes')) return json({});
    if (url.pathname.endsWith('/deployments')) return json({ id: 'deployment' });
    if (/\/domains\/(www\.)?example\.com$/.test(url.pathname)) return json({ status: 'active' });
    return inventory(request, { projects: [{ name: 'jini-demo' }], domains: [{ name: 'example.com', status: 'active' }, { name: 'www.example.com', status: 'active' }],
      records: [{ id: 'conflicting-a', name: 'example.com', type: 'A', content: '192.0.2.1' }] });
  } });
  const config = { customDomain: 'example.com' };
  const inspected = await pages.preview({ credential, config, kit: f.kit, projectName: 'demo' });
  const result = await pages.create({ credential, config, kit: f.kit }).publish({ files, projectName: 'demo', metadata: { domainApproval: { plan: inspected.domains, authorize: async () => true } } });
  assert.equal(result.providerMetadata.hosting.status, 'ready');
  assert.ok(result.providerMetadata.hostnames.every(host => host.contentVerified && host.operationFailed));
  assert.equal(result.status, 'link-delayed');
  assert.match(result.statusMessage, /conflicting-a.*Check the token permissions/);
});

test('Pages reuses a project created concurrently, including Cloudflare duplicate errors with HTTP 400', async () => {
  let exists = false;
  const f = fixture({ respond: ({ url, init }) => {
    if (url.pathname.endsWith('/pages/projects/jini-demo')) return json({ name: 'jini-demo' }, exists ? 200 : 404);
    if (url.pathname.endsWith('/pages/projects') && init.method === 'POST') { exists = true; return json(null, 400, { errors: [{ message: 'Project already exists' }] }); }
    if (url.pathname.endsWith('/upload-token')) return json({ jwt: 'upload' });
    if (url.pathname.endsWith('/check-missing')) return json([]);
    if (url.pathname.endsWith('/upsert-hashes')) return json({});
    if (url.pathname.endsWith('/deployments')) return json({ id: 'deployment' });
    throw new Error(`Unexpected ${url}`);
  } });
  assert.equal((await pages.create({ credential, config: {}, kit: f.kit }).publish({ files, projectName: 'demo' })).status, 'ready');
  assert.equal(f.calls.filter(call => call.url.endsWith('/pages/projects/jini-demo')).length, 2);
});

test('denied hosting inventory also marks requested domain inventory unknown with no proposed mutations', async () => {
  const f = fixture({ respond: () => json(null, 403) });
  const result = await workers.preview({ credential, config: { customDomain: 'example.com' }, kit: f.kit, projectName: 'demo' });
  assert.equal(result.domains.inventoryStatus, 'unknown');
  assert.deepEqual(result.domains.changes, []);
  assert.deepEqual(result.domains.hostnames.map(host => host.status), ['unknown', 'unknown']);
  assert.match(result.domains.message, /HTTP 403.*permission/);
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});


test('account-owned tokens verify at the account endpoint without probing the user endpoint', async () => {
  for (const module of [workers, pages]) {
    const f = fixture({ respond: ({ url, init, index }) => {
      assert.equal(url.pathname, '/client/v4/accounts/account/tokens/verify');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, `Bearer ${credential.token}`);
      assert.equal(index, 1);
      return json({ status: 'active' });
    } });
    assert.deepEqual(await module.verifyCredential({ credential, kit: f.kit }), { ok: true });
    assert.equal(f.calls.length, 1);
  }
});

test('user-owned tokens survive a rejection from the account-only endpoint', async () => {
  for (const module of [workers, pages]) {
    for (const status of [400, 401, 403, 404]) {
      const f = fixture({ respond: ({ url }) => url.pathname.includes('/accounts/') ? json({}, status) : json({ status: 'active' }) });
      assert.deepEqual(await module.verifyCredential({ credential, kit: f.kit }), { ok: true });
      assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), [
        '/client/v4/accounts/account/tokens/verify', '/client/v4/user/tokens/verify',
      ]);
      assert.ok(f.calls.every(call => call.options.timeoutMs === f.kit.timeouts.QUICK));
    }
  }
});

test('token rejection requires an authoritative response; outage and malformed data stay unreachable', async () => {
  for (const [accountStatus, userStatus, reason] of [[403, 401, 'rejected'], [403, 503, 'unreachable'], [503, 200, 'unreachable']]) {
    const f = fixture({ respond: ({ url }) => url.pathname.includes('/accounts/') ? json({}, accountStatus) : json({}, userStatus) });
    const result = await workers.verifyCredential({ credential, kit: f.kit });
    assert.equal(result.reason, reason);
    assert.equal(result.ok, false);
    assert.equal(f.calls.length, accountStatus === 503 ? 1 : 2);
  }
  for (const body of [null, {}, { success: true }, { success: false, errors: [{ message: 'private provider response' }] }]) {
    const f = fixture({ respond: () => Response.json(body) });
    assert.deepEqual(await workers.verifyCredential({ credential, kit: f.kit }), { ok: false, reason: 'unreachable', statusCode: 200 });
  }
  for (const respond of [() => new Response('not JSON'), () => { throw new Error('private transport failure'); }]) {
    const f = fixture({ respond });
    const result = await workers.verifyCredential({ credential, kit: f.kit });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unreachable');
    assert.ok(!JSON.stringify(result).includes('private'));
  }
  const f = fixture({ respond: ({ url }) => {
    assert.equal(url.pathname, '/client/v4/user/tokens/verify');
    return json({ status: 'active' });
  } });
  assert.deepEqual(await workers.verifyCredential({ credential: { token: credential.token }, kit: f.kit }), { ok: true });
});
