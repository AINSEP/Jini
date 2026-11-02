import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDomains, assertDomainApproval, applyDomains } from '../domains.mjs';
import { createApi } from '../api.mjs';
import { fixture, inventory, credential, json } from './fixture.mjs';

function setup(options = {}) {
  const fake = fixture({ respond: request => inventory(request, options) });
  const api = createApi({ credential, kit: fake.kit });
  return { ...fake, api, request: { api, kit: fake.kit, targetId: 'cloudflare-workers', resourceName: 'jini-demo', domain: 'example.com' } };
}

test('clean apex and www preview makes only authenticated reads and discloses both attachments', async () => {
  const f = setup();
  const plan = await previewDomains(f.request);
  assert.equal(plan.inventoryStatus, 'complete');
  assert.deepEqual(plan.hostnames.map(host => host.hostname), ['example.com', 'www.example.com']);
  assert.deepEqual(plan.changes.map(change => change.method), ['PUT', 'PUT']);
  assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
  assert.doesNotMatch(JSON.stringify(plan), /secret-test-token/);
});

test('records, disabled bindings, other Pages projects and overlapping wildcard routes are disclosed', async () => {
  const f = setup({
    records: [{ id: 'a', type: 'A', name: 'example.com', content: '192.0.2.1' }, { id: 'mail', type: 'MX', name: 'example.com', content: 'mail.example.com' }, { id: 'c', type: 'CNAME', name: 'www.example.com', content: 'old.example.net' }],
    workers: [{ id: 'worker', hostname: 'www.example.com', service: 'other', environment: 'production', enabled: false }],
    routes: [{ id: 'route', pattern: '*.example.com/private/*', script: 'other' }],
    projects: [{ name: 'old' }], domains: [{ name: 'example.com', status: 'active' }],
  });
  const plan = await previewDomains(f.request);
  assert.equal(plan.changes.filter(change => change.method === 'DELETE').length, 5);
  assert.ok(plan.changes.some(change => change.widerImpact));
  assert.ok(!plan.changes.some(change => change.path.endsWith('/mail')));
  assert.equal(plan.hostnames[0].records.length, 2);
  assert.equal(plan.hostnames[1].workerBindings[0].enabled, false);
  assert.equal(plan.hostnames[0].pagesBindings[0].projectName, 'old');
});

test('permission denied and truncated inventories are unknown, never clear', async () => {
  for (const response of [json(null, 403), json([], 200, { result_info: { total_pages: 1000 } })]) {
    const f = fixture({ respond: request => request.url.pathname.endsWith('/workers/domains') ? response.clone() : inventory(request) });
    const api = createApi({ credential, kit: f.kit });
    const plan = await previewDomains({ api, kit: f.kit, targetId: 'cloudflare-pages', resourceName: 'jini-demo', domain: 'example.com' });
    assert.equal(plan.inventoryStatus, 'unknown');
    assert.equal(plan.errorCode, 'CLOUDFLARE_INVENTORY_UNKNOWN');
    assert.match(plan.message, /permissions|inventory/i);
    assert.deepEqual(plan.changes, []);
  }
});

test('unconfirmed, forged and stale execute are refused before mutations', async () => {
  const f = setup();
  const plan = await previewDomains(f.request);
  await assert.rejects(assertDomainApproval({ ...f.request, approval: { confirmed: true }, plan }), /CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED/);
  await assert.rejects(assertDomainApproval({ ...f.request, approval: { authorize: () => true, plan: { ...plan, fingerprint: 'stale' } } }), /CLOUDFLARE_DOMAIN_PLAN_STALE/);
  assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
});

test('Pages preview keeps exact CNAMEs and ownership marker; apex is supported', async () => {
  const f = setup({ records: [{ id: 'same', type: 'CNAME', name: 'example.com', content: 'jini-demo.pages.dev', proxied: true, ttl: 1 }], projects: [{ name: 'jini-demo' }], domains: [{ name: 'example.com', status: 'active' }] });
  const plan = await previewDomains({ ...f.request, targetId: 'cloudflare-pages' });
  assert.ok(!plan.changes.some(change => change.path.endsWith('/same')));
  assert.equal(plan.changes.filter(change => change.method === 'POST').length, 2);
  assert.match(plan.changes.find(change => change.body?.type === 'CNAME').body.comment, /^jini-deploy:/);
});

test('zone mismatch/inactive, malformed hostname and unknown zone fail closed with next steps', async () => {
  const f = setup();
  for (const domain of ['https://example.com', 'bad..com', '*.example.com', 'example.com:443']) await assert.rejects(previewDomains({ ...f.request, domain }), /CLOUDFLARE_INVALID_DOMAIN/);
  for (const zone of [null, { id: 'zone', name: 'other.com', status: 'active', type: 'full', account: { id: 'account' } }, { id: 'zone', name: 'example.com', status: 'pending', type: 'full', account: { id: 'account' } }]) {
    const fake = fixture({ respond: request => request.url.pathname.endsWith('/zones/zone') ? json(zone) : inventory(request) });
    const plan = await previewDomains({ ...f.request, api: createApi({ credential, kit: fake.kit }), kit: fake.kit });
    assert.equal(plan.inventoryStatus, 'unknown');
    assert.match(plan.message, /preview again/);
  }
});

test('confirmed apply uses exactly reviewed changes; mail remains, TLS/content verify both names', async () => {
  const f = fixture({ respond: request => {
    const { url, init } = request;
    if (init.method === 'PUT') return json({ id: 'binding' });
    if (url.pathname.endsWith('/ssl/certificate_packs')) return json([{ status: 'active', hosts: ['example.com', '*.example.com'] }]);
    return inventory(request, { records: [{ id: 'mail', name: 'example.com', type: 'MX', content: 'mail.example.com' }] });
  } });
  const api = createApi({ credential, kit: f.kit });
  const input = { api, kit: f.kit, targetId: 'cloudflare-workers', resourceName: 'jini-demo', domain: 'example.com' };
  const plan = await previewDomains(input);
  const accepted = await assertDomainApproval({ ...input, approval: { plan, authorize: async () => true } });
  const result = await applyDomains({ api, kit: f.kit, plan: accepted, proof: { path: '/proof', expected: 'digest' } });
  assert.ok(result.every(host => host.status === 'pending')); // Fake inventory deliberately never installs bindings.
  assert.deepEqual(f.calls.filter(call => call.init.method !== 'GET').map(call => call.init.method), ['PUT', 'PUT']);
  assert.ok(f.calls.every(call => !call.url.endsWith('/mail')));
});

test('expired authorization, changed inventory before cutover and apply API failure remain safe', async () => {
  const f = setup();
  const preview = await previewDomains(f.request);
  const plan = await assertDomainApproval({ ...f.request, approval: { plan: preview, authorize: async () => true } });
  await assert.rejects(assertDomainApproval({ ...f.request, approval: { plan, authorize: async () => false } }), /CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED.*expired/);
  const fake = fixture({ respond: request => inventory(request, { records: [{ id: 'changed', type: 'A', name: 'example.com', content: '192.0.2.2' }] }) });
  const states = await applyDomains({ api: createApi({ credential, kit: fake.kit }), kit: fake.kit, plan, proof: { path: '/proof', expected: 'digest' } });
  assert.ok(states.every(host => host.errorCode === 'CLOUDFLARE_DOMAIN_PLAN_STALE'));
  assert.ok(fake.calls.every(call => call.init.method === 'GET'));
  const failed = fixture({ respond: request => request.init.method === 'PUT' ? json(null, 403) : inventory(request) });
  const failedStates = await applyDomains({ api: createApi({ credential, kit: failed.kit }), kit: failed.kit, plan, proof: { path: '/proof', expected: 'digest' } });
  assert.ok(failedStates.every(host => host.status === 'failed' && host.message.includes(host.hostname)));
});

test('wildcard DNS and inherited CAA are disclosed but preserved; pending Pages validation is retried explicitly', async () => {
  const f = setup({ records: [
    { id: 'wild', type: 'A', name: '*.example.com', content: '192.0.2.1' },
    { id: 'caa', type: 'CAA', name: 'example.com', content: '0 issue letsencrypt.org' },
    { id: 'txt', type: 'TXT', name: 'example.com', content: 'verification-data' },
  ], projects: [{ name: 'jini-demo' }], domains: [{ name: 'example.com', status: 'pending' }] });
  const plan = await previewDomains({ ...f.request, targetId: 'cloudflare-pages' });
  assert.equal(plan.hostnames[1].records.length, 2);
  assert.ok(plan.changes.some(change => change.method === 'PATCH' && change.hostname === 'example.com'));
  assert.ok(!plan.changes.some(change => change.method === 'DELETE'));
});

test('same-resource disabled Worker binding is reattached; a malformed inventory refuses', async () => {
  const f = setup({ workers: [{ id: 'disabled', hostname: 'example.com', service: 'jini-demo', environment: 'production', enabled: false }] });
  const plan = await previewDomains(f.request);
  assert.equal(plan.changes.filter(change => change.method === 'PUT').length, 2);
  const broken = setup({ records: [{ name: 'example.com', type: 'A', content: '192.0.2.1' }] });
  assert.equal((await previewDomains(broken.request)).inventoryStatus, 'unknown');
});

test('applying a serialized preview without a human capability refuses with no mutations', async () => {
  const f = setup();
  const plan = await previewDomains(f.request);
  const result = await applyDomains({ api: f.api, kit: f.kit, plan: JSON.parse(JSON.stringify(plan)), proof: { path: '/proof', expected: 'digest' } });
  assert.ok(result.every(host => host.errorCode === 'CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED'));
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});

test('existing Custom Domains on this Worker preserve their managed origin DNS', async () => {
  const workers = ['example.com', 'www.example.com'].map((hostname, index) => ({ id: `binding-${index}`, hostname, service: 'jini-demo', environment: 'production' }));
  const f = setup({ workers, records: [{ id: 'managed', type: 'A', name: 'example.com', content: '192.0.2.1', meta: { auto_added: true } }] });
  const plan = await previewDomains(f.request);
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.hostnames[0].dnsOwnership, 'worker-managed');
  assert.equal(plan.hostnames[0].status, 'configured');
  assert.equal(plan.hostnames[0].contentVerified, false, 'configuration alone never claims deployed content');
});

test('Worker transfer detaches first and skips DNS removed automatically by that detachment', async () => {
  let detached = false;
  const attached = [];
  const old = { id: 'old-worker', hostname: 'example.com', service: 'old-worker', environment: 'production' };
  const record = { id: 'old-managed-dns', name: 'example.com', type: 'A', content: '192.0.2.1' };
  const f = fixture({ respond: request => {
    const { url, init } = request;
    if (init.method === 'DELETE') {
      assert.ok(url.pathname.endsWith('/workers/domains/old-worker'), 'binding detachment owns its DNS removal');
      detached = true;
      return json({ id: 'old-worker' });
    }
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      attached.push({ id: `new-${attached.length}`, hostname: body.hostname, service: body.service, environment: body.environment });
      return json(attached.at(-1));
    }
    if (url.pathname.endsWith('/ssl/certificate_packs')) return json([{ status: 'active', hosts: ['example.com', '*.example.com'] }]);
    return inventory(request, { records: detached ? [] : [record], workers: detached ? attached : [old] });
  } });
  const api = createApi({ credential, kit: f.kit });
  const input = { api, kit: f.kit, targetId: 'cloudflare-workers', resourceName: 'jini-demo', domain: 'example.com' };
  const preview = await previewDomains(input);
  const plan = await assertDomainApproval({ ...input, approval: { plan: preview, authorize: async () => true } });
  const result = await applyDomains({ api, kit: f.kit, plan, proof: { path: '/proof', expected: 'digest' } });
  assert.ok(result.every(host => host.status === 'ready'));
  assert.deepEqual(f.calls.filter(call => call.init.method !== 'GET').map(call => call.init.method), ['DELETE', 'PUT', 'PUT']);
});

test('duplicate paginated identities are unknown rather than an apparently complete inventory', async () => {
  const record = { id: 'same-id', name: 'example.com', type: 'A', content: '192.0.2.1' };
  const f = setup({ records: [record, record] });
  const plan = await previewDomains(f.request);
  assert.equal(plan.inventoryStatus, 'unknown');
  assert.match(plan.message, /repeated identities/);
  assert.deepEqual(plan.changes, []);
});

test('inventory response ordering alone does not change the approved fingerprint', async () => {
  const records = [{ id: 'address', name: 'example.com', type: 'A', content: '192.0.2.1' }, { id: 'mail', name: 'example.com', type: 'MX', content: 'mail.example.com' }];
  const first = await previewDomains(setup({ records }).request);
  const reordered = await previewDomains(setup({ records: [...records].reverse() }).request);
  assert.equal(first.fingerprint, reordered.fingerprint);
});
