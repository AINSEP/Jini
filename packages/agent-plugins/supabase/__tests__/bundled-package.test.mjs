import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/supabase/__tests__). The structural checks run here on the
// plugin's own files; the checks that call Tovu's MCP-metadata and credential-card parsers stay
// with Tovu's tests, because those parsers are Tovu host code.
const root = path.resolve(import.meta.dirname, '..');
const readJson = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const readText = name => readFile(path.join(root, 'skills/supabase', name), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the supabase package ships its manifest, hosted connection, skill and recovery guide', async () => {
  assert.deepEqual(await shippedFiles(), [
    'mcp.json', 'plugin.json', 'skills/supabase/SKILL.md', 'skills/supabase/references/failure-modes.md',
  ]);
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.name, 'supabase');
  assert.equal(manifest.extensions.jini.id, 'tovu/supabase');
  assert.deepEqual(manifest.extensions.jini.provides, ['database:supabase']);
  assert.match(await readText('SKILL.md'), /references\/failure-modes\.md/);
});

test('OAuth and token fallback target the hosted service without inline secrets', async () => {
  const server = (await readJson('mcp.json')).mcpServers.supabase;
  assert.equal(server.type, 'streamable-http');
  assert.equal(new URL(server.url).origin, 'https://mcp.supabase.com');
  assert.equal(server.authMode, 'oauth');
  assert.equal(server.tokenAuth.helpUrl, 'https://supabase.com/dashboard/account/tokens');
  assert.equal(server.tokenAuth.probeUrl, 'https://api.supabase.com/v1/projects');
  assert.equal(server.headers, undefined);
  assert.equal(server.env, undefined);
  assert.match(await readText('SKILL.md'), /[Cc]onnect(?:ing)? the account/);
  assert.match(await readText('SKILL.md'), /Never show a key or password/);
  assert.match(await readText('references/failure-modes.md'), /secure connection card/);
});

// Plan v2 §5.1: legacy env and auth metadata stay as they were.
test('the legacy token import and retired env names are kept', async () => {
  const tokenAuth = (await readJson('mcp.json')).mcpServers.supabase.tokenAuth;
  assert.equal(tokenAuth.importFromEnv, 'TOVU_SUPABASE_MCP_ACCESS_TOKEN');
  assert.equal(tokenAuth.retiredEnv.length, 8);
  assert.ok(tokenAuth.retiredEnv.includes('TOVU_SUPABASE_MCP_ENABLED'));
});

test('the cards are browser sign-in first, then a Management API token fallback', async () => {
  const cards = (await readJson('plugin.json')).extensions.jini.credentialCards;
  assert.deepEqual(cards.map(card => [card.target, card.saveKind]), [
    ['supabase-sign-in', 'oauth'], ['supabase', 'agent-plugin-token'],
  ]);
  const token = cards[1];
  assert.equal(token.title, 'Connect Supabase with an access token');
  assert.match(token.keyHint, /Management API.*Project Settings.*Database.*Migrations/);
  assert.equal(token.helpUrl, 'https://supabase.com/dashboard/account/tokens');
  for (const card of cards) {
    assert.ok(card.intro, card.target);
    assert.deepEqual(card.usedFor, [
      'Finds your accounts and databases',
      'Reads the selected database',
      'Sets up databases and applies database changes you approve',
    ], card.target);
  }
});

// Plan v2 §5.1: drop the "host opens links in new tabs" assumption; product words are host-neutral.
test('the shipped text is host-neutral and assumes nothing about how links open', async () => {
  const manifest = await readJson('plugin.json');
  assert.doesNotMatch(`${manifest.description}\n${manifest.extensions.jini.summary}`, /\bTovu\b/);
  for (const name of ['SKILL.md', 'references/failure-modes.md']) {
    const text = await readText(name);
    assert.doesNotMatch(text, /\bTovu\b/, name);
    assert.doesNotMatch(text, /new tab/i, name);
  }
});
