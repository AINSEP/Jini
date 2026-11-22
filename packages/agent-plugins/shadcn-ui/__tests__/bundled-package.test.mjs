import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// shadcn/ui guidance moved out of ui-ux-design into its own plugin (owner, 2026-11-19): React and
// Tailwind app work loads it on its own. The skill tree moved unchanged, with its license and notice.
const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
const frontmatter = (text) => text.split('\n---')[0];

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the whole shadcn-ui skill tree ships with its license and notice', async () => {
  assert.deepEqual(await shippedFiles(), [
    'CHANGELOG.md', 'LICENSE', 'NOTICE', 'mcp.json', 'plugin.json',
    'skills/shadcn-ui/README.md', 'skills/shadcn-ui/SKILL.md',
    'skills/shadcn-ui/examples/auth-layout.tsx', 'skills/shadcn-ui/examples/data-table.tsx', 'skills/shadcn-ui/examples/form-pattern.tsx',
    'skills/shadcn-ui/resources/component-catalog.md', 'skills/shadcn-ui/resources/customization-guide.md',
    'skills/shadcn-ui/resources/migration-guide.md', 'skills/shadcn-ui/resources/setup-guide.md',
    'skills/shadcn-ui/scripts/verify-setup.sh',
  ]);
  assert.match(await read('LICENSE'), /Apache License\s+Version 2\.0/);
  assert.match(await read('NOTICE'), /google-labs-code\/stitch-skills/);
});

test('the manifest names its own plugin and version', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.equal(manifest.name, 'shadcn-ui');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.extensions.jini.id, 'jini/shadcn-ui');
  assert.match(await read('CHANGELOG.md'), /\n## 0\.1\.0\n/);
  assert.deepEqual(JSON.parse(await read('mcp.json')).mcpServers, {});
});

test('shadcn keeps its coding-tool list and tells every host to discover tools first', async () => {
  const skill = await read('skills/shadcn-ui/SKILL.md');
  assert.ok(frontmatter(skill).includes('allowed-tools:\n  - "shadcn*:*"\n  - "mcp_shadcn*"\n  - "Read"\n  - "Write"\n  - "Bash"\n  - "web_fetch"'));
  assert.ok(flat(skill).includes('Discover the tools available in the current host before using them. Use only capabilities that the host provides and permits. The CLI and React examples below describe work in an authorized coding checkout; they do not authorize shell commands or dependency installation in another environment. If shadcn MCP tools are unavailable, explain the limitation. Do not invent tool availability or install dependencies to bypass host restrictions.'));
});

test('no shipped text names one host or its tools', async () => {
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await read(file), /\bTovu\b|agent_plugin_|search_tools|describe_tool/, file);
  }
});
