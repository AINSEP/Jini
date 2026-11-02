import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import destination from '../cloudflare-d1.mjs';
import workers from '../../targets/cloudflare-workers.mjs';
import { acknowledgeFormSubmissions, pullFormSubmissions } from '../../lib/forms.mjs';

test('the D1 destination pulls and acknowledges through the same receiver client the Worker serves', () => {
  assert.equal(destination.pull, pullFormSubmissions);
  assert.equal(destination.ack, acknowledgeFormSubmissions);
  assert.deepEqual(Object.keys(destination).sort(), ['ack', 'pull']);
});

test('the descriptor declares it co-hosted on Workers only, and the hosting target no longer pulls', async () => {
  const file = JSON.parse(await readFile(new URL('../../tovu-form-destinations.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, { schemaVersion: 1, destinations: [{ id: 'cloudflare-d1', label: 'Cloudflare (D1 in your account)', module: 'form-destinations/cloudflare-d1.mjs', receive: 'co-hosted', hosts: ['cloudflare-workers'] }] });
  assert.equal('pullFormSubmissions' in workers, false);
  assert.equal('acknowledgeFormSubmissions' in workers, false);
});
