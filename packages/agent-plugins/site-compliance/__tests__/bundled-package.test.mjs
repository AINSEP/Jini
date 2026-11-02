import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/site-compliance/__tests__), where it packed through Tovu's
// lifecycle wrapper. Plugin-local now: the folder walk below is what the assembler ships (tests
// excluded); the packed archive is covered by Jini's standalone-agent-plugin integration test.
const root = path.resolve(import.meta.dirname, '..');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the shipped screening guidance includes every rulepack and preserves evidence limits', async () => {
  const files = await shippedFiles();
  const skill = await readFile(path.join(root, 'skills/site-compliance/SKILL.md'), 'utf8');
  for (const name of ['gdpr-eu-uk', 'ccpa-cpra', 'wcag-2-2']) {
    const ref = `references/${name}.md`;
    assert.ok(files.includes(`skills/site-compliance/${ref}`), ref);
    assert.ok(skill.includes(ref), ref);
  }
  assert.match(skill, /Every finding carries evidence/);
  assert.match(skill, /cannot-determine/);
  assert.match(skill, /Never emit, in any wording/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8')).mcpServers, {});
});

test('the shipped text is host-neutral and keeps the frozen publisher id', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'site-compliance');
  assert.equal(manifest.extensions.tovu.id, 'tovu/site-compliance');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b/, file);
  }
});
