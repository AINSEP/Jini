import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/google-login). Member routes and host-specific
// instructions now live in the host overlay. Tovu's
// credential-card, exports-runtime and login-provider tests stay with the host (they exercise
// Tovu's parsers and runtime). The packed archive is covered by Jini's standalone integration test.
const root = path.resolve(import.meta.dirname, '..');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('every file the sign-in button export names ships in the payload', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const button = manifest.extensions.jini.exports['sign-in-button'];
  const files = await shippedFiles();
  for (const file of [button.template, button.styles, ...Object.values(button.assets)]) {
    assert.ok(files.includes(file), file);
  }
});

test('the login provider and its card agree, and the publisher id is unchanged', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions.jini.id, 'tovu/google-login');
  const [card] = manifest.extensions.jini.credentialCards;
  const { providers: [provider] } = JSON.parse(await readFile(path.join(root, 'tovu-login-providers.json'), 'utf8'));
  assert.equal(provider.credentialCardTarget, card.target);
  assert.equal(provider.credentialLabel, card.label);
  assert.deepEqual(provider.scopes, ['openid', 'email', 'profile']);
});
