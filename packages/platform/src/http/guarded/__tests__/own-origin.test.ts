import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import { createHttpClient } from '../client.js';
import { EgressRefusedError } from '../errors.js';
import type { EgressPolicy, PinnedPeer } from '../ports.js';

const origin = 'http://localhost:43127';
const policy: EgressPolicy = {
  allowedSchemes: ['http', 'https'], denyPrivateAddresses: true, devHostAllowlist: [],
  loopbackOriginAllowlist: [origin], maxRedirects: 5, connectTimeoutMs: 1000,
  maxResponseBytes: 10000, maxDecompressedBytes: 10000,
};
function harness({ replies = [], addresses = ['127.0.0.1'], policy: egressPolicy = policy }: { replies?: HttpResponse[]; addresses?: string[]; policy?: EgressPolicy } = {}) {
  const sent: { request: HttpRequest; peer: PinnedPeer }[] = [];
  const client = createHttpClient({
    policy: egressPolicy, userAgent: 'Fixture/1',
    dns: { resolve: async () => addresses },
    clock: { nowMs: () => 0, timeoutSignal: ({ timeoutMs }) => AbortSignal.timeout(timeoutMs) },
    transport: { requestPinned: async call => {
      sent.push(call);
      return replies[sent.length - 1] ?? { status: 200, headers: {}, bodyText: 'Visit us' };
    } },
  });
  const send = (url: string) => client.send({ request: { method: 'GET', url, headers: {}, timeoutMs: 1000 } });
  return { send, sent };
}

test('the configured site origin can read its own localhost page through a pinned peer', async () => {
  const h = harness();
  assert.equal((await h.send(`${origin}/visit-us`)).bodyText, 'Visit us');
  assert.equal(h.sent[0]!.peer.ip, '127.0.0.1');
  assert.equal(h.sent[0]!.peer.port, 43127);
});

test('a site origin exception never grants another scheme, hostname, port or URL credentials', async () => {
  for (const url of ['http://localhost:43128/', 'https://localhost:43127/', 'http://127.0.0.1:43127/', 'http://other.example:43127/', 'http://user:pw@localhost:43127/']) {
    const h = harness();
    await assert.rejects(h.send(url), EgressRefusedError);
    assert.equal(h.sent.length, 0, url);
  }
});

test('own-site redirects recheck every destination and refuse other private services', async () => {
  for (const location of ['http://localhost:43128/', 'http://127.0.0.1:43127/', 'http://10.0.0.1/', 'http://169.254.169.254/', 'http://[fd00::1]/']) {
    const h = harness({ replies: [{ status: 302, headers: { location }, bodyText: '' }] });
    await assert.rejects(h.send(`${origin}/redirect`), EgressRefusedError);
    assert.equal(h.sent.length, 1, location);
  }
  const h = harness({ replies: [{ status: 302, headers: { location: '/visit-us' }, bodyText: '' }] });
  assert.equal((await h.send(`${origin}/redirect`)).status, 200);
  assert.equal(h.sent.length, 2);
});

test('DNS rebinding and mixed private answers remain refused even for the configured origin', async () => {
  for (const addresses of [['10.0.0.1'], ['169.254.169.254'], ['fd00::1'], ['127.0.0.1', '192.168.1.1']]) {
    const h = harness({ addresses });
    await assert.rejects(h.send(`${origin}/visit-us`), EgressRefusedError);
    assert.equal(h.sent.length, 0);
  }
});

test('a configured public hostname cannot rebind to loopback through the site-origin exception', async () => {
  const configured = 'http://site.example:43127';
  const h = harness({ policy: { ...policy, loopbackOriginAllowlist: [configured] } });
  await assert.rejects(h.send(`${configured}/visit-us`), EgressRefusedError);
  assert.equal(h.sent.length, 0);
});

test('configured IPv4 and IPv6 loopback literals pin their exact own-site origin', async () => {
  for (const configured of ['http://127.0.0.1:43127', 'http://[::1]:43127']) {
    const h = harness({ policy: { ...policy, loopbackOriginAllowlist: [configured] } });
    assert.equal((await h.send(`${configured}/visit-us`)).status, 200);
    assert.equal(h.sent[0]!.peer.ip, configured.includes('[::1]') ? '::1' : '127.0.0.1');
  }
});
