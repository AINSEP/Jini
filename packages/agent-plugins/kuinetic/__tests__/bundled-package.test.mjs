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

// "Redesign this site, use kuinetic" previously ranked kuinetic first and delivered only it on turn 1,
// so its core named the exact call that loaded the ui-ux-design core before any design work.
test('the core keeps the conditional ui-ux-design fallback near the top', async () => {
  const skill = await read('skills/kuinetic/SKILL.md');
  const fallback = "If the ui-ux-design plugin is available, load its ui-ux-design skill first using this host's plugin guidance reader; otherwise follow the basic design rules below.";
  assert.ok(skill.includes(fallback), 'the exact portable conditional fallback is present');
  assert.ok(skill.indexOf(fallback) < skill.indexOf('\n## '), 'before the first section');
  assert.doesNotMatch(skill, /load_agent_plugin/, 'the fallback uses the current host guidance reader');
  assert.deepEqual(JSON.parse(await read('plugin.json')).extensions.jini.companions, ['ui-ux-design'], 'the router receives the named design companion');
});

test('the manifest and its own changelog version the plugin independently of ui-ux-design', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.equal(manifest.name, 'kuinetic');
  assert.equal(manifest.version, '0.1.1', 'the companion guidance advances the inner version');
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
