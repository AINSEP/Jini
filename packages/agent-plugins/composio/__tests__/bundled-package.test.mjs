import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/composio/__tests__). The structural checks run here on the
// plugin's own files; the checks that call Tovu's MCP-metadata and credential-card parsers stay
// with Tovu's tests, because those parsers are Tovu host code.
const root = path.resolve(import.meta.dirname, '..');
const readJson = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const readSkill = () => readFile(path.join(root, 'skills/composio/SKILL.md'), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the composio package ships its manifest, hosted connection and one skill', async () => {
  assert.deepEqual(await shippedFiles(), ['mcp.json', 'plugin.json', 'skills/composio/SKILL.md']);
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.name, 'composio');
  assert.equal(manifest.extensions.tovu.id, 'tovu/composio');
  assert.deepEqual(manifest.extensions.tovu.provides, ['app-connectors']);
});

test('the hosted connection supports browser sign-in without inline credentials', async () => {
  const config = await readJson('mcp.json');
  assert.deepEqual(config.mcpServers.composio, {
    type: 'streamable-http', url: 'https://connect.composio.dev/mcp', tovuAuthMode: 'oauth',
  });
  const skill = await readSkill();
  assert.match(skill, /agent_plugin_connect/);
  assert.match(skill, /Do not grant.*COMPOSIO_REMOTE_WORKBENCH/s);
  assert.match(skill, /COMPOSIO_REMOTE_BASH_TOOL/);
  assert.match(skill, /Never ask the user for a Composio API key/);
});

test('the one connection card is browser sign-in with its task purposes', async () => {
  const cards = (await readJson('plugin.json')).extensions.tovu.credentialCards;
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card.target, 'composio');
  assert.equal(card.saveKind, 'oauth');
  assert.equal(card.title, 'Connect Composio');
  assert.match(card.keyHint, /Browser sign-in only/);
  assert.equal(card.helpUrl, undefined);
  assert.ok(card.intro);
  assert.ok(card.permissions);
  assert.deepEqual(card.usedFor, [
    'Finds tools for your other apps',
    'Connects each app with your approval and carries out the tasks you request',
  ]);
});

// Plan v2 §5.1: the public-URL setting, the settings-screen path and the restart step are Tovu's;
// they live in Tovu's overlay (content/agent-plugin-overlays/composio/GUIDANCE.md).
test('the shipped text is host-neutral', async () => {
  const manifest = await readJson('plugin.json');
  assert.doesNotMatch(`${manifest.description}\n${manifest.extensions.tovu.summary}`, /\bTovu\b/);
  const skill = await readSkill();
  assert.doesNotMatch(skill, /\bTovu\b|TOVU_PUBLIC_URL|Settings\s*>\s*External MCP|Restart the assistant|remote-declares-not-read-only/);
  assert.match(skill, /host guidance/);
});
