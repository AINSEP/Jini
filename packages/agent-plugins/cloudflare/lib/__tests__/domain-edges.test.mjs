import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDomains, assertDomainApproval, applyDomains } from '../domains.mjs';
import { pollDomains } from '../domain-status.mjs';
import { dnsMarker } from '../dns.mjs';
import { createApi } from '../api.mjs';
import { fixture, inventory, credential, json, routes } from './fixture.mjs';

/** Fail-closed edges of inspection, approval, cutover and status polling. */
function setup({ respond, ...options } = {}) {
  const fake = fixture({ respond: respond ?? (request => inventory(request, options)) });
  const api = createApi({ credential, kit: fake.kit });
  return { ...fake, api, request: { api, kit: fake.kit, targetId: 'cloudflare-workers', resourceName: 'jini-demo', domain: 'example.com' } };
}
const proof = { path: '/proof', expected: 'digest' };
const hostnames = [{ hostname: 'example.com' }, { hostname: 'www.example.com' }];

test('a Pages CNAME carrying this publisher\'s marker reports marked ownership; others stay unmarked', async () => {
  const comment = dnsMarker({ resourceName: 'jini-demo', targetHost: 'jini-demo.pages.dev' });
  const f = setup({ records: [{ id: 'same', type: 'CNAME', name: 'example.com', content: 'jini-demo.pages.dev.', comment }],
    projects: [{ name: 'jini-demo' }], domains: [{ name: 'example.com', status: 'active' }] });
  const plan = await previewDomains({ ...f.request, targetId: 'cloudflare-pages' });
  assert.deepEqual(plan.hostnames.map(host => host.dnsOwnership), ['marked', 'unmarked']);
  assert.ok(!plan.changes.some(change => change.path.endsWith('/same')));
});

test('more than 100 Pages projects is an unknown inventory, never a truncated clear one', async () => {
  const projects = Array.from({ length: 101 }, (_, index) => ({ name: `project-${index}` }));
  const f = setup({ respond: routes([['/pages/projects', 'GET', () => json(projects, 200, { result_info: { total_pages: 1 } })]], request => inventory(request)) });
  const plan = await previewDomains(f.request);
  assert.equal(plan.inventoryStatus, 'unknown');
  assert.match(plan.message, /More than 100 Pages projects/);
  assert.deepEqual(plan.changes, []);
});

test('a zone row without an id is not a selectable zone', async () => {
  const f = setup({ respond: routes([['/zones', 'GET', () => json([{ name: 'example.com' }])]], request => inventory(request)) });
  const plan = await previewDomains(f.request);
  assert.equal(plan.inventoryStatus, 'unknown');
  assert.match(plan.message, /No accessible zone matches example.com/);
});

test('approval with an incomplete inventory refuses before any mutation', async () => {
  const f = setup({ respond: request => request.url.pathname.endsWith('/workers/routes') ? json(null, 403) : inventory(request) });
  await assert.rejects(assertDomainApproval({ ...f.request, approval: { plan: { fingerprint: 'any' }, authorize: async () => true } }), { code: 'CLOUDFLARE_INVENTORY_UNKNOWN' });
  assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
});

test('a DNS record changed after the final recheck stops the cutover before deleting it', async () => {
  let reads = 0;
  const original = { id: 'old-a', type: 'A', name: 'example.com', content: '192.0.2.1' };
  const f = setup({ respond: routes([
    ['/dns_records', 'GET', () => { reads += 1; return json([reads > 3 ? { ...original, content: '192.0.2.9' } : original]); }],
  ], request => inventory(request)) });
  const preview = await previewDomains(f.request);
  assert.deepEqual(preview.changes.map(change => change.method), ['DELETE', 'PUT', 'PUT']);
  const plan = await assertDomainApproval({ ...f.request, approval: { plan: preview, authorize: async () => true } });
  const states = await applyDomains({ api: f.api, kit: f.kit, plan, proof });
  assert.ok(states.every(host => host.errorCode === 'CLOUDFLARE_DOMAIN_PLAN_STALE' && host.status === 'failed'));
  assert.match(states[0].message, /old-a changed during cutover/);
  assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'), 'nothing was deleted or attached');
});

test('an approval port failure without a code still reports a named, partial cutover failure', async () => {
  const f = setup();
  const plan = await previewDomains(f.request);
  const states = await applyDomains({ api: f.api, kit: f.kit, plan: { ...plan, authorize: async () => { throw new Error('approval store offline'); } }, proof });
  assert.ok(states.every(host => host.errorCode === 'CLOUDFLARE_DOMAIN_FAILED' && host.operationFailed));
  assert.match(states[1].message, /^www\.example\.com: approval store offline Hosting is retained/);
});

test('status probes that fail become unknown per host, with the provider or a generic code', async () => {
  const f = fixture({ respond: ({ url }) => url.pathname.endsWith('/www.example.com') ? json(null, 403) : json({ status: 'active' }) });
  const kit = { ...f.kit, probeContent: async () => { throw new Error('socket closed'); } };
  const states = await pollDomains({ api: createApi({ credential, kit }), kit, plan: { targetId: 'cloudflare-pages', resourceName: 'jini-demo', hostnames }, proof }, { attempts: 1 });
  assert.deepEqual(states.map(host => [host.status, host.errorCode]), [['unknown', 'CLOUDFLARE_DOMAIN_STATUS_UNKNOWN'], ['unknown', 'CLOUDFLARE_API_ERROR']]);
  assert.match(states[0].message, /^example\.com: socket closed/);
});

test('a Pages domain without a status, and Worker certificates in an unexpected shape, stay pending', async () => {
  const pages = fixture({ respond: () => json({}) });
  const pending = await pollDomains({ api: createApi({ credential, kit: pages.kit }), kit: pages.kit, plan: { targetId: 'cloudflare-pages', resourceName: 'jini-demo', hostnames }, proof }, { attempts: 1 });
  assert.deepEqual(pending.map(host => [host.status, host.domainStatus]), [['pending', 'pending'], ['pending', 'pending']]);
  const bound = hostnames.map(({ hostname }) => ({ hostname, service: 'jini-demo', environment: 'production' }));
  const workers = fixture({ respond: ({ url }) => json(url.pathname.endsWith('/workers/domains') ? bound : { certificates: [{ status: 'active', hosts: ['example.com'] }] }) });
  const states = await pollDomains({ api: createApi({ credential, kit: workers.kit }), kit: workers.kit,
    plan: { targetId: 'cloudflare-workers', resourceName: 'jini-demo', zone: { id: 'zone' }, hostnames }, proof }, { attempts: 1 });
  assert.deepEqual(states.map(host => [host.status, host.certificateStatus]), [['pending', 'pending'], ['pending', 'pending']]);
});
