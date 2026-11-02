import assert from 'node:assert/strict';
import test from 'node:test';
import pages from '../cloudflare-pages.mjs';
import workers from '../cloudflare-workers.mjs';
import { fixture, credential, json } from '../../lib/__tests__/fixture.mjs';

// Moved from Tovu's shared content/agent-plugins/__tests__/hosting-public-urls.test.mjs (its
// Cloudflare case); the other hosting plugins took their own cases with them.
test('Cloudflare hosting variants resolve their own Pages and account-scoped Workers addresses without writes', async () => {
  const f = fixture({ respond: ({ url, init }) => {
    assert.equal(init.method ?? 'GET', 'GET');
    assert.ok(url.pathname.endsWith('/workers/subdomain'));
    return json({ subdomain: 'actual-account' });
  } });
  const context = { credential, config: { resourceName: 'remote-name' }, kit: f.kit };
  assert.equal(await pages.create(context).resolvePublicUrl({ projectName: 'zoran' }), 'https://remote-name.pages.dev');
  assert.equal(await workers.create(context).resolvePublicUrl({ projectName: 'zoran' }), 'https://remote-name.actual-account.workers.dev');
  assert.equal(f.calls.length, 1);
});
