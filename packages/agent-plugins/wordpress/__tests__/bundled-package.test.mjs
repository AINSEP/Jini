import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/wordpress/__tests__), where it packed through Tovu's
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

test('the WordPress package ships both guides without a deploy target or connection card', async () => {
  const files = await shippedFiles();
  const skillPath = 'skills/wordpress/SKILL.md';
  const skill = await readFile(path.join(root, skillPath), 'utf8');
  assert.ok(files.includes(skillPath));
  for (const name of ['subdomain', 'free-site-redirect']) {
    const ref = `references/${name}.md`;
    assert.ok(files.includes(`skills/wordpress/${ref}`), ref);
    assert.ok(skill.includes(ref), ref);
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'wordpress');
  assert.equal(manifest.extensions.tovu.id, 'tovu/wordpress');
  assert.equal(manifest.extensions.tovu.credentialCards, undefined);
  assert.ok(!files.includes('tovu-deploy-targets.json'));
  assert.ok(!files.includes('mcp.json'));
  assert.ok(!manifest.extensions.tovu.provides.some(value => value.startsWith('deploy-target:')));
});

test('the shipped text is host-neutral (vendor-free guidance, owner 2026-11-02)', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b|features\/agent-plugins/, file);
  }
});
