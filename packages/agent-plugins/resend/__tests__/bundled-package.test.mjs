import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/resend) and split per plan v2 §5.1: the webhook route,
// suppression behavior and secret rotation live in the host's overlay now. Tovu's bundled-mail and
// resend-mcp tests stay with the host (they exercise Tovu's lifecycle, registries and MCP wiring).
const root = path.resolve(import.meta.dirname, '..');
// Frozen identifier: the sending key's label is persisted in operators' vaults (plan §4.3).
const FROZEN_LABEL = 'Tovu Mail — Resend API';

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

const skill = () => readFile(path.join(root, 'skills/resend/SKILL.md'), 'utf8');

test('the payload ships the mail adapter its contribution names, with its helper modules', async () => {
  const files = await shippedFiles();
  const { adapters } = JSON.parse(await readFile(path.join(root, 'tovu-mail-adapters.json'), 'utf8'));
  assert.deepEqual(adapters.map(adapter => adapter.module), ['adapters/resend.mjs']);
  assert.equal(adapters[0].credentialLabel, FROZEN_LABEL);
  for (const file of ['adapters/resend.mjs', 'lib/domains.mjs', 'lib/errors.mjs', 'lib/feedback.mjs']) {
    assert.ok(files.includes(file), file);
  }
});

test('the webhook route, suppression rules and rotation labels moved to the host overlay', async () => {
  const text = await skill();
  const webhook = text.split('## Bounces and complaints (webhook)')[1];
  assert.ok(webhook, 'the skill still tells the agent bounces arrive by webhook');
  assert.match(webhook, /follow the host guidance for this plugin/);
  assert.match(webhook, /signing secret must not\s+pass through the chat/);
  assert.doesNotMatch(text, /\/hooks\/mail\/resend|Webhook Secret|\(previous\)|503/);
  assert.doesNotMatch(text, /Email → Provider|Use this provider/);
});

test('the portable skill keeps account and sending keys apart through their secure cards', async () => {
  const text = await skill();
  assert.match(text, /Save it through the Connect Resend card/);
  assert.match(text, /Full access/);
  assert.match(text, /mail credential label the host reads/);
  assert.doesNotMatch(text, /credential_save|Tovu/);
  assert.match(text, /Never ask for the key in chat/);
});

test('the shipped text is host-neutral apart from frozen identifiers, and keeps the publisher id', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions.jini.id, 'tovu/resend');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => /\.(md|mjs)$/.test(name))) {
    const text = (await readFile(path.join(root, file), 'utf8')).replaceAll(FROZEN_LABEL, '');
    assert.doesNotMatch(text, /\bTovu\b/, file);
  }
});
