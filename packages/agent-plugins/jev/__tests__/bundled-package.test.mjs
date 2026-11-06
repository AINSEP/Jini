import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/jev/__tests__), where it packed through Tovu's lifecycle
// wrapper. Plugin-local now: the folder walk below is what the assembler ships (tests excluded);
// the packed archive itself is covered by Jini's standalone-agent-plugin integration test.
const root = path.resolve(import.meta.dirname, '..');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the design-only package ships its API references without claiming executable chat tools', async () => {
  const files = await shippedFiles();
  for (const name of ['primitives-reference', 'javascript-sdk', 'jaggedness', 'patterns', 'cookbooks']) {
    assert.ok(files.includes(`skills/jev/references/${name}.md`), name);
  }
  const mcp = JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers, {});
  const skill = await readFile(path.join(root, 'skills/jev/SKILL.md'), 'utf8');
  assert.match(skill, /This plugin has no MCP server/);
  assert.match(skill, /TYPESAFE_API_KEY.*never in chat/);
  assert.match(skill, /non-generative/);
});

test('the shipped text is host-neutral and keeps the frozen publisher id', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'jev');
  assert.equal(manifest.extensions.jini.id, 'tovu/jev');
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b/, file);
  }
});
