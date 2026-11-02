import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * @file Pins the host-neutral google-workspace skill text, manifest and contribution files after
 * the move from Tovu's bundled `content/agent-plugins/google-workspace` (plan v2 §5.1). Tovu's own
 * tool names, admin paths and OAuth callback route moved to Tovu's overlay
 * (`content/agent-plugin-overlays/google-workspace`), whose test checks them against Tovu's tools.
 * Frozen identifiers (the `tovu-*.json` contracts, `TOVU_GOOGLE_*` config names, the
 * `_tovu_submission_id` / `_tovu_submitted_at` sheet columns, publisher id) stay as they were.
 */
const root = path.resolve(import.meta.dirname, '..');
const skillDir = path.join(root, 'skills/google-workspace');
const references = ['connection.md', 'form-delivery.md', 'sheets.md', 'troubleshooting.md'];
const contributionFiles = ['tovu-admin-surfaces.json', 'tovu-agent-tools.json', 'tovu-connections.json', 'tovu-form-destinations.json'];

const read = file => readFileSync(path.join(root, file), 'utf8');
const readJson = file => JSON.parse(read(file));
const skill = () => read('skills/google-workspace/SKILL.md');

/** SKILL.md and every reference, each with its name for assertion messages. */
function skillTexts() {
  return [{ name: 'SKILL.md', text: skill() },
    ...references.map(name => ({ name, text: read(`skills/google-workspace/references/${name}`) }))];
}

test('the manifest keeps its publisher id, products and credential cards; its prose names no host', () => {
  const manifest = readJson('plugin.json');
  const host = manifest.extensions.tovu;
  assert.equal(manifest.name, 'google-workspace');
  assert.equal(host.id, 'tovu/google-workspace');
  assert.deepEqual(host.provides, ['api-connection:google-workspace', 'form-destination:google-sheets']);
  assert.deepEqual(host.credentialCards.map(card => card.target), ['google-workspace-sign-in', 'google-workspace-oauth-client']);
  assert.doesNotMatch(`${manifest.description} ${host.summary}`, /\bTovu\b/);
  assert.match(manifest.description, /drive\.file permission, never the whole Drive/);
  assert.deepEqual(readJson('mcp.json').mcpServers, {});
  assert.deepEqual(readJson('products.json').products.map(product => product.id), ['sheets']);
});

// Recorded debt (plan v2 §5.1): only Tovu consumes the own-client card, so its callback route stays
// literal, with no templating. A second host needs its own card under its own extensions key.
test('the own-client card still names the callback route Tovu serves (recorded debt)', () => {
  const card = readJson('plugin.json').extensions.tovu.credentialCards[1];
  assert.match(card.keyHint, /\/api\/agent-plugins\/connections\/oauth\/callback/);
});

test('every reference is linked from SKILL.md, and none is orphaned', () => {
  assert.deepEqual(readdirSync(path.join(skillDir, 'references')).sort(), references);
  const text = skill();
  for (const reference of references) assert.ok(text.includes(`(references/${reference})`), reference);
});

test('the skill and references name no host tool, admin path, route or product', () => {
  const hostOnly = /\bTovu\b|agent_plugin_|credential_save|plugins_set_enabled|p_google_workspace__|Admin →|Agent Plugins →|\/api\/agent-plugins/;
  for (const { name, text } of skillTexts()) assert.doesNotMatch(text, hostOnly, name);
  assert.match(skill(), /\*\*Follow the host guidance first\.\*\*/);
});

test('frozen identifiers survive the neutral wording', () => {
  const delivery = read('skills/google-workspace/references/form-delivery.md');
  const connection = read('skills/google-workspace/references/connection.md');
  assert.match(delivery, /`_tovu_submission_id`, `_tovu_submitted_at`/);
  assert.match(connection, /`TOVU_GOOGLE_PICKER_BROWSER_KEY`, `TOVU_GOOGLE_PICKER_APP_ID`/);
  for (const text of [skill(), connection]) assert.match(text, /google-workspace-oauth-client/);
  const connectionContract = readJson('tovu-connections.json').connections[0];
  assert.equal(connectionContract.clients.web.clientIdEnv, 'TOVU_GOOGLE_WORKSPACE_OAUTH_WEB_CLIENT_ID');
});

test('the safety rules are still stated', () => {
  const text = skill();
  assert.match(text, /never ask\s+the person to pick between sign-in and a key/);
  assert.match(text, /Never offer to replace a working sign-in or saved app unless asked/);
  assert.match(text, /Never ask for a secret in chat/);
  assert.match(text, /\*\*A pasted spreadsheet link grants nothing\.\*\*/);
  assert.match(text, /only for \*\*`drive\.file`\*\*/);
  assert.match(text, /Never repeat an append, create or copy just because the answer was lost/);
  assert.match(read('skills/google-workspace/references/connection.md'), /Never tell the person\s+revocation succeeded unless this site said "confirmed"/);
});

// Drift guard: markdown cannot fail a build, so a renamed or removed tool would leave the skill
// telling every agent to call something that does not exist.
test('every tool the skill cites is declared, and every declared tool is cited', () => {
  const declared = new Set(readJson('tovu-agent-tools.json').tools.map(tool => tool.name));
  const cited = new Set();
  for (const { text } of skillTexts()) {
    for (const match of text.matchAll(/`((?:sheets_[a-z0-9_]*[a-z0-9])|account_info)(?=[` {(])/g)) cited.add(match[1]);
  }
  assert.deepEqual([...cited].filter(name => !declared.has(name)).sort(), [], 'cited but not declared');
  assert.deepEqual([...declared].filter(name => !cited.has(name)).sort(), [], 'declared but never explained');
});

// Cross-slice check: the runtime modules move in their own slice; this goes green once both land.
test('every module path a contribution file declares exists in the plugin folder', () => {
  const modules = [
    ...readJson('tovu-agent-tools.json').tools.map(tool => tool.module),
    ...readJson('tovu-connections.json').connections.map(connection => connection.module),
    ...readJson('tovu-form-destinations.json').destinations.map(destination => destination.module),
    ...readJson('tovu-admin-surfaces.json').surfaces.flatMap(surface => [surface.entry, surface.handlerModule, ...surface.files]),
  ];
  for (const file of contributionFiles) assert.ok(existsSync(path.join(root, file)), file);
  assert.deepEqual([...new Set(modules)].filter(file => !existsSync(path.join(root, file))).sort(), []);
});
