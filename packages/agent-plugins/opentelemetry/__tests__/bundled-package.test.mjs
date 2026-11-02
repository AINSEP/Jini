import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/opentelemetry/__tests__/credential-card.test.mjs), which parsed the card
// with Tovu's credential-card parser and packed through Tovu's lifecycle wrapper. Plugin-local now: the
// manifest is checked directly, and the folder walk below is what the assembler ships (tests excluded).
// The parser-level check belongs to the host (Tovu overlay); the packed archive is covered by
// Jini's standalone-agent-plugin integration test and this package's pack test.
const root = path.resolve(import.meta.dirname, '..');
const face = 'opentelemetry';
const provider = 'observability-opentelemetry';

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

const readManifest = async () => JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));

test(`${face}: one provider-settings card that saves the ${provider} provider plugin through the host`, async () => {
  const host = (await readManifest()).extensions.tovu;
  assert.equal(host.id, `tovu/${face}`, 'frozen publisher id');
  assert.equal(host.providerPlugin, provider, 'the face follows the provider in its own package');
  assert.equal(host.displayName, 'OpenTelemetry');
  const [card, ...rest] = host.credentialCards;
  assert.equal(rest.length, 0);
  assert.equal(card.target, face);
  assert.equal(card.saveKind, 'provider-settings');
  assert.equal(card.saveTarget, provider);
  assert.equal(card.title, 'Connect OpenTelemetry (Grafana Cloud, Honeycomb…)');
  assert.match(card.helpUrl, /^https:\/\//);
  assert.equal(card.baseUrl, undefined, 'the provider plugin owns every destination');
  assert.equal(card.fields, undefined, 'the provider plugin declares the fields');
});

test(`${face}: the skill opens that card, checks provider_status first, and never takes a token in chat`, async () => {
  const skill = await readFile(path.join(root, `skills/${face}/SKILL.md`), 'utf8');
  assert.match(skill, new RegExp(`^---\nname: ${face}\ndescription: .+\n---\n`));
  assert.ok(skill.includes(`credential_save {kind:"plugin-provider", target:"${face}"}`));
  assert.ok(skill.includes(`provider_status {pluginId:"${provider}"}`));
  assert.ok(skill.indexOf('provider_status') < skill.indexOf('credential_save'), 'status is checked before the card opens');
  assert.match(skill, /Never ask for (a|the) .+ in chat/);
});

test(`${face}: ships guidance only, with no MCP servers and no code`, async () => {
  assert.deepEqual(await shippedFiles(), ['mcp.json', 'plugin.json', `skills/${face}/SKILL.md`]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8')).mcpServers, {});
});

test(`${face}: the shipped text is host-neutral`, async () => {
  assert.doesNotMatch((await readManifest()).description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b/, file);
  }
});
