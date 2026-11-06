import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/ui-ux-design/__tests__), where it packed through Tovu's
// lifecycle wrapper and pinned Tovu's chat rules in the skill text. The shared copy now carries the
// owner-approved host-neutral wording (w1, 2026-11-02); Tovu's chat rules and its "Bash" removal are
// pinned by Tovu's overlay tests at the point where the model receives the guidance.
const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

const frontmatter = (text) => text.split('\n---')[0];

test('all seven design skills and the references they name travel in the package', async () => {
  const files = await shippedFiles();
  const entries = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file));
  assert.equal(entries.length, 7);
  for (const entry of entries) {
    const skill = await read(entry);
    assert.match(skill, /^---\nname: /, entry);
    for (const match of skill.matchAll(/`(references\/[\w/-]+\.md)`/g)) {
      assert.ok(files.includes(path.posix.join(path.posix.dirname(entry), match[1])), `${entry}: ${match[1]}`);
    }
  }
  assert.deepEqual(JSON.parse(await read('mcp.json')).mcpServers, {});
});

test('the manifest keeps the card summary and the search keywords of both former copies', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.deepEqual(manifest.extensions, { jini: {
    displayName: 'UI/UX Design',
    summary: 'Helps the assistant design clean, accessible pages and components.',
    id: 'jini/ui-ux-design',
    provides: ['ui-design'],
  } });
  assert.deepEqual(manifest.keywords, ['design', 'ui', 'ux', 'ui-design', 'theme', 'page', 'website', 'layout']);
  // Hosts seeded Tovu's 0.6.0; an equal or lower version over different bytes is refused or flagged.
  assert.equal(manifest.version, '0.6.3');
});

test('the design skill carries the shared tool-use wording, not one host\'s chat rules', async () => {
  const skill = flat(await read('skills/ui-ux-design/SKILL.md'));
  assert.ok(skill.includes('## Tool use and context Load this skill and the references needed for the task through the current host\'s guidance reader. Discover available editing, media and screenshot tools before using them. Follow the host\'s tool permissions. CLI examples apply only to an authorized coding checkout. If a capability is missing, explain the limitation instead of inventing a tool. Use supplied specs and design notes as context; this skill does not require a particular repository or framework. Return the design in the conversation unless the user requests a saved artifact through an available tool.'));
  assert.ok(skill.includes('- Read any supplied feature spec, current product UI constraints and architecture decisions before making visual decisions; state assumptions where context is missing.'));
  assert.doesNotMatch(skill, /Read the active spec|## Tovu tool use/);
});

test('shadcn keeps its coding-tool list and tells every host to discover tools first', async () => {
  const skill = await read('skills/shadcn-ui/SKILL.md');
  assert.ok(frontmatter(skill).includes('allowed-tools:\n  - "shadcn*:*"\n  - "mcp_shadcn*"\n  - "Read"\n  - "Write"\n  - "Bash"\n  - "web_fetch"'));
  assert.ok(flat(skill).includes('Discover the tools available in the current host before using them. Use only capabilities that the host provides and permits. The CLI and React examples below describe work in an authorized coding checkout; they do not authorize shell commands or dependency installation in another environment. If shadcn MCP tools are unavailable, explain the limitation. Do not invent tool availability or install dependencies to bypass host restrictions.'));
});

test('web-compliance declares its name and description', async () => {
  assert.equal(frontmatter(await read('skills/web-compliance/SKILL.md')), '---\nname: web-compliance\ndescription: Screen website features for privacy, consent, accessibility and policy risks using observed evidence; identify uncertainty for specialist review, without certifying legal compliance.');
});

test('no shipped text names one host or its tools', async () => {
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await read(file), /\bTovu\b|agent_plugin_ui_ux_design|search_tools|describe_tool/, file);
  }
});
