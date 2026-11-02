import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../api.mjs';
import { fixture, credential, json } from './fixture.mjs';

for (const status of [401, 403, 429, 500]) test(`API ${status} names resource and next step without echoing token/error body`, async () => {
  const f = fixture({ respond: () => json({ token: credential.token }, status, { errors: [{ message: credential.token }] }) });
  const api = createApi({ credential, kit: f.kit });
  await assert.rejects(api.request({ path: '/accounts/account/pages/projects/site', method: 'POST', body: { name: 'site' } }), error => {
    assert.equal(error.code, 'CLOUDFLARE_API_ERROR');
    assert.match(error.message, /projects\/site.*HTTP/);
    assert.doesNotMatch(error.message, /secret-test-token/);
    assert.match(error.message, status === 429 ? /Wait/ : /Check/);
    return true;
  });
  assert.equal(f.calls[0].init.redirect, 'error');
});

test('API credentials, missing resources, non-JSON, network and false-success refusals', async () => {
  const f = fixture({ respond: () => json({}, 404) });
  for (const missing of [{ token: '', accountId: 'account' }, { token: 'token', accountId: '' }]) assert.throws(() => createApi({ credential: missing, kit: f.kit }), /CLOUDFLARE_CREDENTIAL_REQUIRED/);
  assert.equal(await createApi({ credential, kit: f.kit }).request({ path: '/missing' }, { allowMissing: true }), null);
  for (const [response, pattern] of [[new Response('<html>bad</html>', { status: 502 }), /CLOUDFLARE_INVALID_RESPONSE/], [json({}, 200, { success: false }), /CLOUDFLARE_API_ERROR/]]) {
    const fake = fixture({ respond: () => response.clone() });
    await assert.rejects(createApi({ credential, kit: fake.kit }).request({ path: '/read' }), pattern);
  }
  const network = fixture({ respond: () => { throw new Error(credential.token); } });
  await assert.rejects(createApi({ credential, kit: network.kit }).request({ path: '/read' }), /CLOUDFLARE_UNREACHABLE.*Check your connection/);
});

test('pagination honors total_pages, total_count and full-page fallback; malformed/capped inventory refuses', async () => {
  for (const info of [{ total_pages: 2 }, { total_count: 2, per_page: 1 }, undefined]) {
    const f = fixture({ respond: ({ url }) => Number(url.searchParams.get('page')) === 1 ? json([1], 200, { result_info: info }) : info ? json([2], 200, { result_info: info }) : json([]) });
    assert.deepEqual(await createApi({ credential, kit: f.kit }).list({ path: '/list?filter=1' }, { perPage: 1 }), info ? [1, 2] : [1]);
    assert.equal(f.calls.length, 2);
  }
  for (const result of [{ invalid: true }, [1]]) {
    const f = fixture({ respond: () => json(result) });
    await assert.rejects(createApi({ credential, kit: f.kit }).list({ path: '/list' }, { perPage: 1, maxPages: 1 }), /CLOUDFLARE_INVENTORY_UNKNOWN/);
  }
});

test('null/primitive JSON and an over-limit page are incomplete responses', async () => {
  for (const value of [null, 'invalid']) {
    const f = fixture({ respond: () => Response.json(value) });
    await assert.rejects(createApi({ credential, kit: f.kit }).request({ path: '/read' }), /CLOUDFLARE_INVALID_RESPONSE/);
  }
  const f = fixture({ respond: () => json([1, 2]) });
  await assert.rejects(createApi({ credential, kit: f.kit }).list({ path: '/list' }, { perPage: 1, maxPages: 1 }), /CLOUDFLARE_INVENTORY_UNKNOWN/);
});

test('an empty page cannot hide a reported inventory total', async () => {
  const f = fixture({ respond: ({ url }) => url.searchParams.get('page') === '1' ? json([1], 200, { result_info: { total_count: 2, per_page: 1 } }) : json([]) });
  await assert.rejects(createApi({ credential, kit: f.kit }).list({ path: '/list' }, { perPage: 1 }), /CLOUDFLARE_INVENTORY_UNKNOWN.*incomplete inventory page/);
});
