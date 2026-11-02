import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/meilisearch). Plugin-local: the folder walk below is what
// the assembler ships (tests excluded); the packed archive is covered by Jini's
// standalone-agent-plugin integration test. Tovu's credential-card and tool-discovery tests stay
// with the host (they exercise Tovu's parsers and tool catalog).
const root = path.resolve(import.meta.dirname, '..');
// Frozen identifiers: the saved credential label is persisted in operators' vaults (plan §4.3).
const FROZEN_LABEL = 'Tovu Search — Meilisearch';

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the payload ships the search provider its contribution file names', async () => {
  const files = await shippedFiles();
  const contribution = JSON.parse(await readFile(path.join(root, 'tovu-search-providers.json'), 'utf8'));
  assert.deepEqual(contribution.providers.map(provider => provider.module), ['providers/meilisearch.mjs']);
  assert.ok(files.includes('providers/meilisearch.mjs'));
  assert.ok(files.includes('skills/meilisearch/SKILL.md'));
});

test('the credential card keeps its frozen label and the skill names that exact label', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const [card] = manifest.extensions.tovu.credentialCards;
  assert.equal(card.label, FROZEN_LABEL);
  assert.equal(card.ownedApiLabel, FROZEN_LABEL);
  const skill = await readFile(path.join(root, 'skills/meilisearch/SKILL.md'), 'utf8');
  assert.ok(skill.includes(`\`${FROZEN_LABEL}\``));
  assert.match(skill, /PUBLIC|public content only/i);
});

test('the shipped text is host-neutral apart from frozen identifiers, and keeps the publisher id', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions.tovu.id, 'tovu/meilisearch');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => /\.(md|mjs)$/.test(name))) {
    const text = (await readFile(path.join(root, file), 'utf8')).replaceAll(FROZEN_LABEL, '');
    assert.doesNotMatch(text, /\bTovu\b/, file);
  }
});
