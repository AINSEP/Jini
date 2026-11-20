import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// kUInetic guidance ships as its own plugin (owner, 2026-11-19) so it can be updated without
// touching ui-ux-design. Its text is the former ui-ux-design `kuinetic-reference.md`, split verbatim.
const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('one kuinetic skill whose load table names exactly the references it ships', async () => {
  const files = await shippedFiles();
  assert.deepEqual(files.filter(file => file.endsWith('/SKILL.md')), ['skills/kuinetic/SKILL.md']);
  const skill = await read('skills/kuinetic/SKILL.md');
  assert.match(skill, /^---\nname: kuinetic\ndescription: Use when /);
  const named = [...skill.matchAll(/`(references\/[\w/-]+\.md)`/g)].map(match => `skills/kuinetic/${match[1]}`).sort();
  assert.deepEqual(named, files.filter(file => file.startsWith('skills/kuinetic/references/')));
  for (const heading of ['## Detect', '## Install And Initialise', '## Attribute Grammar', '## Reduced Motion', '## Gotchas']) {
    assert.ok(skill.includes(`\n${heading}\n`), heading);
  }
});

// Jini's automatic guidance limit (MAX_AUTOMATIC_GUIDANCE_BYTES, src/lifecycle/automatic-use.ts) is
// 8 KiB for the SKILL.md, its file inventory and the host's framing together; 512 bytes cover the framing.
test('the delivered SKILL.md and its file inventory stay under the 8 KiB automatic guidance limit', async () => {
  const inventory = (await shippedFiles()).filter(file => file.startsWith('skills/kuinetic/references/'))
    .map(file => file.slice('skills/kuinetic/'.length));
  const bytes = Buffer.byteLength(await read('skills/kuinetic/SKILL.md')) + Buffer.byteLength(JSON.stringify(inventory));
  assert.ok(bytes + 512 < 8 * 1024, `${bytes} bytes`);
});

// "Redesign this site, use kuinetic" ranks kuinetic first and delivers only it on turn 1, so its
// core names the exact call that loads the ui-ux-design core before any design work.
test('the core names the ui-ux-design load call near the top', async () => {
  const skill = await read('skills/kuinetic/SKILL.md');
  const call = '`load_agent_plugin({ "pluginId": "ui-ux-design", "skill": "ui-ux-design" })`';
  assert.ok(skill.includes(call));
  assert.ok(skill.indexOf(call) < skill.indexOf('\n## '), 'before the first section');
  assert.match(skill, /before designing or redesigning a theme or page, load the ui-ux-design core/);
});

test('the manifest and its own changelog version the plugin independently of ui-ux-design', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.equal(manifest.name, 'kuinetic');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.extensions.jini.id, 'jini/kuinetic');
  assert.ok(manifest.keywords.includes('kuinetic'));
  assert.match(await read('CHANGELOG.md'), new RegExp(`\n## ${manifest.version.replaceAll('.', '\\.')}\n`));
  assert.deepEqual(JSON.parse(await read('mcp.json')).mcpServers, {});
});

test('no shipped text names one host or its tools', async () => {
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await read(file), /\bTovu\b|agent_plugin_|search_tools|describe_tool/, file);
  }
});
