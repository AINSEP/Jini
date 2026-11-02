import assert from 'node:assert/strict';
import test from 'node:test';
import { pollDomains } from '../domain-status.mjs';
import { createApi } from '../api.mjs';
import { fixture, credential, json } from './fixture.mjs';
const base = { resourceName: 'jini-demo', zone: { id: 'zone', name: 'example.com' }, hostnames: [{ hostname: 'example.com' }, { hostname: 'www.example.com' }] };
const proof = { path: '/proof.txt', expected: 'exact deployed digest' };

test('Workers needs the right binding, active covering certificate and exact content on BOTH hosts', async () => {
  for (const [active, content, expected] of [[true, true, 'ready'], [false, true, 'pending'], [true, false, 'pending']]) {
    const f = fixture({ respond: ({ url }) => url.pathname.endsWith('/workers/domains')
      ? json(base.hostnames.map(({ hostname }) => ({ hostname, service: 'jini-demo', environment: 'production' })))
      : json([{ status: active ? 'active' : 'pending', hosts: ['example.com', '*.example.com'] }]) });
    const kit = { ...f.kit, probeContent: async input => { assert.equal(input.expected, proof.expected); return content; } };
    const result = await pollDomains({ api: createApi({ credential, kit }), kit, plan: { ...base, targetId: 'cloudflare-workers' }, proof }, { attempts: 2 });
    assert.deepEqual(result.map(host => host.status), [expected, expected]);
    assert.equal(result[0].contentVerified, expected === 'ready');
  }
});

test('Pages keeps per-host partial states, bounded backoff and missing-probe refusal', async () => {
  const f = fixture({ respond: ({ url }) => json({ status: url.pathname.endsWith('/example.com') ? 'active' : 'pending' }) });
  const plan = { ...base, targetId: 'cloudflare-pages' };
  const result = await pollDomains({ api: createApi({ credential, kit: f.kit }), kit: f.kit, plan, proof }, { attempts: 6 });
  assert.deepEqual(result.map(host => host.status), ['ready', 'pending']);
  assert.equal(f.kit.now(), 23000);
  const noProbe = { ...f.kit, probeContent: undefined };
  assert.equal((await pollDomains({ api: createApi({ credential, kit: f.kit }), kit: noProbe, plan, proof }, { attempts: 1 }))[0].status, 'pending');
});
