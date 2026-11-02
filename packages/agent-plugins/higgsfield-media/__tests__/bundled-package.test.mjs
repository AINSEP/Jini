import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/higgsfield-media/__tests__). The structural checks run here
// on the plugin's own files; the checks that call Tovu's MCP-metadata and credential-card parsers,
// and the tool-catalog discovery check, stay with Tovu's tests, because they need Tovu host code.
const root = path.resolve(import.meta.dirname, '..');
const skillDir = path.join(root, 'skills/higgsfield-media');
const references = ['failure-modes.md', 'models-and-plan-gates.md'];
const readJson = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const readText = name => readFile(path.join(skillDir, name), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the higgsfield-media package ships its skill and both references, each cited', async () => {
  const files = await shippedFiles();
  const skill = await readText('SKILL.md');
  assert.deepEqual(files, [
    'mcp.json', 'plugin.json', 'skills/higgsfield-media/SKILL.md',
    ...references.map(name => `skills/higgsfield-media/references/${name}`),
  ]);
  for (const name of references) assert.ok(skill.includes(`references/${name}`), name);
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.name, 'higgsfield-media');
  assert.equal(manifest.extensions.tovu.id, 'tovu/higgsfield-media');
  assert.deepEqual(manifest.extensions.tovu.provides, ['media:image', 'media:video']);
});

// The tools the skill's own setup table names (Step B). The sign-in grants exactly these, so a
// person who enables the plugin and signs in can generate with no trip to the host's settings
// (owner, 2026-11-02: "the user should not have to do this. should just work").
const DECLARED_TOOLS = ['generate_image', 'generate_video', 'models_explore', 'job_status', 'jobs_wait', 'show_generations', 'reveal_generation', 'show_generation_by_ids'];
const DECLARED_WRITE_TOOLS = ['generate_image', 'generate_video', 'reveal_generation'];

test('browser sign-in and operator read trust are declared without a token', async () => {
  const config = await readJson('mcp.json');
  assert.deepEqual(config.mcpServers.higgsfield, { type: 'streamable-http', url: 'https://mcp.higgsfield.ai/mcp' });
  const metadata = (await readJson('plugin.json')).extensions.tovu.mcpServers.higgsfield;
  assert.equal(metadata.tovuAuthMode, 'oauth');
  assert.deepEqual(metadata.tovuDefaultTools.read, ['models_explore', 'job_status']);
  assert.deepEqual(metadata.tovuDefaultTools.allow, DECLARED_TOOLS, 'the sign-in grants the tools the skill documents');
  assert.deepEqual(metadata.tovuDefaultTools.write, DECLARED_WRITE_TOOLS, 'the generators that write get their may-write grant at sign-in');
  const skill = await readText('SKILL.md');
  assert.match(skill, /agent_plugin_connect/);
  assert.match(skill, /media_import_from_url/);
  assert.match(skill, /Never store credentials/);
});

test('the one connection card is browser sign-in with its task purposes', async () => {
  const cards = (await readJson('plugin.json')).extensions.tovu.credentialCards;
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card.target, 'higgsfield-media');
  assert.equal(card.saveKind, 'oauth');
  assert.equal(card.title, 'Connect Higgsfield');
  assert.match(card.keyHint, /Browser sign-in only/);
  assert.equal(card.helpUrl, undefined);
  assert.ok(card.intro);
  assert.ok(card.permissions);
  assert.deepEqual(card.usedFor, [
    'Checks available image and video models and generation progress',
    "Generates images and videos using your account's credits",
  ]);
});

test('the skill still teaches the asynchronous job pipeline and forbids sync polling', async () => {
  const skill = await readText('SKILL.md');
  assert.match(skill, /generate_image[^]*job_status[^]*media_import_from_url/);
  assert.match(skill, /Never pass `sync: true`/);
  assert.match(skill, /writeAllowedToolNames/);
});

// Plan v2 §5.1: the public-URL setting, the settings-screen path, the restart step, Tovu source
// paths and Tovu's deployment diagnosis text live in Tovu's overlay
// (content/agent-plugin-overlays/higgsfield-media/).
test('the shipped text is host-neutral', async () => {
  const manifest = await readJson('plugin.json');
  assert.doesNotMatch(`${manifest.description}\n${manifest.extensions.tovu.summary}`, /\bTovu\b/);
  const hostOnly = /\bTovu\b|TOVU_PUBLIC_URL|Settings → External MCP|Restart the assistant|daemon 500|15,?000 ?ms|mcp-federation|\.ts`/;
  for (const name of ['SKILL.md', ...references.map(ref => `references/${ref}`)]) {
    assert.doesNotMatch(await readText(name), hostOnly, name);
  }
  assert.match(await readText('SKILL.md'), /host guidance/);
});
