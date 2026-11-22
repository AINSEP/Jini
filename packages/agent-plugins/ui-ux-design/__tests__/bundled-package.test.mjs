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

test('the six design skills and the references they name travel in the package', async () => {
  const files = await shippedFiles();
  const entries = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file));
  assert.deepEqual(entries.map(entry => entry.split('/')[1]),
    ['frontend-accessibility', 'gstack-design', 'interface-design', 'ui-ux-design', 'vercel-web-design-guidelines', 'web-compliance']);
  for (const entry of entries) {
    const skill = await read(entry);
    assert.match(skill, /^---\nname: /, entry);
    for (const match of skill.matchAll(/`(references\/[\w/-]+\.md)`/g)) {
      assert.ok(files.includes(path.posix.join(path.posix.dirname(entry), match[1])), `${entry}: ${match[1]}`);
    }
  }
  assert.deepEqual(JSON.parse(await read('mcp.json')).mcpServers, {});
});

// Jini's automatic guidance limit (MAX_AUTOMATIC_GUIDANCE_BYTES, src/lifecycle/automatic-use.ts) is
// 8 KiB for everything delivered together: this SKILL.md, its file inventory and a host's overlay.
// The core keeps half of it so a host overlay still fits; everything else is an on-demand reference.
test('the always-delivered core stays within half the 8 KiB automatic guidance limit', async () => {
  assert.ok(Buffer.byteLength(await read('skills/ui-ux-design/SKILL.md')) <= 4096);
});

test('the core names every reference, every other skill and the split-out plugins in its load table', async () => {
  const core = await read('skills/ui-ux-design/SKILL.md');
  const table = core.slice(core.indexOf('## Load before you build'));
  for (const file of (await shippedFiles()).filter(name => name.startsWith('skills/ui-ux-design/references/'))) {
    assert.ok(table.includes('`' + file.slice('skills/ui-ux-design/'.length) + '`'), file);
  }
  for (const skill of ['frontend-accessibility', 'web-compliance', 'interface-design', 'gstack-design', 'vercel-web-design-guidelines']) {
    assert.ok(table.includes(`skill \`${skill}\``), skill);
  }
  assert.ok(table.includes('| use kUInetic, or the theme already uses it | the `kuinetic` plugin (skill `kuinetic`) first,'));
  assert.ok(table.includes('the `shadcn-ui` plugin'));
});

test('a redesign keeps the theme design system, and the full workflow moved intact', async () => {
  assert.ok(flat(await read('skills/ui-ux-design/SKILL.md')).includes('A redesign keeps the existing theme\'s design system: its tokens, fonts, colours, spacing and components.'));
  const workflow = await read('skills/ui-ux-design/references/full-workflow.md');
  for (const heading of ['## Execution', '## UI Loop Contract', '## Guardrails', '## Output', '## Reference', '### Decision Rule', '### Failure Path']) {
    assert.ok(workflow.includes(`\n${heading}\n`), heading);
  }
});

test('shadcn-ui and kUInetic are separate plugins, not files of this one', async () => {
  const files = await shippedFiles();
  assert.deepEqual(files.filter(file => /shadcn|kuinetic-reference/.test(file)), []);
  for (const plugin of ['shadcn-ui', 'kuinetic']) {
    assert.equal(JSON.parse(await readFile(path.join(root, '..', plugin, 'plugin.json'), 'utf8')).name, plugin);
  }
});

test('the manifest keeps the card summary and the search keywords of both former copies', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.deepEqual(manifest.extensions, { jini: {
    displayName: 'UI/UX Design',
    summary: 'Helps the assistant design clean, accessible pages and components.',
    id: 'jini/ui-ux-design',
    provides: ['ui-design'],
  } });
  assert.doesNotMatch(manifest.description, /shadcn/);
  assert.deepEqual(manifest.keywords, ['design', 'ui', 'ux', 'ui-design', 'theme', 'page', 'website', 'layout',
    'redesign', 'restyle', 'look and feel']);
  // Hosts seeded Tovu's 0.6.0; an equal or lower version over different bytes is refused or flagged.
  assert.equal(manifest.version, '0.7.1', 'versions the portable browser and saving guidance');
});

test('the design skill carries the shared tool-use wording, not one host\'s chat rules', async () => {
  const skill = flat(await read('skills/ui-ux-design/SKILL.md'));
  assert.ok(skill.includes('## Tool use and context Load this skill and the references needed for the task through the current host\'s guidance reader. Discover available editing, media and screenshot tools before using them. Follow the host\'s tool permissions. CLI examples apply only to an authorized coding checkout. If a capability is missing, explain the limitation instead of inventing a tool. Use supplied specs and design notes as context; this skill does not require a particular repository or framework.'), 'retains host permissions and capability limits');
  assert.ok(skill.includes('- Read any supplied feature spec, current product UI constraints and architecture decisions before making visual decisions; state assumptions where context is missing.'));
  assert.doesNotMatch(skill, /Read the active spec|## Tovu tool use/);
});

test('web-compliance declares its name and description', async () => {
  assert.equal(frontmatter(await read('skills/web-compliance/SKILL.md')), '---\nname: web-compliance\ndescription: Screen website features for privacy, consent, accessibility and policy risks using observed evidence; identify uncertainty for specialist review, without certifying legal compliance.');
});

test('no shipped text names one host or its tools', async () => {
  for (const file of (await shippedFiles()).filter(name => name.endsWith('.md'))) {
    assert.doesNotMatch(await read(file), /\bTovu\b|agent_plugin_ui_ux_design|search_tools|describe_tool/, file);
  }
});

test('uses the running target and reports actual viewport coverage', async () => {
  const matrix = flat(await read('skills/ui-ux-design/references/chrome-mobile-test-matrix.md'));
  const loop = flat(await read('skills/ui-ux-design/references/ui-loop.md'));
  const gstack = flat(await read('skills/gstack-design/SKILL.md'));
  assert.match(matrix, /Use the already-running target if supplied/, 'reuses the supplied target');
  assert.match(matrix, /Start a local target only when needed in a permitted checkout/, 'startup requires a permitted checkout');
  assert.match(matrix, /actual draft or public target/, 'verifies the intended target');
  assert.match(matrix, /project matrix where supported/, 'respects the project viewport contract');
  for (const width of ['320 × 568', '360 × 800', '390 × 844', '430 × 932']) {
    assert.ok(matrix.includes(width), `retains the default ${width} target`);
  }
  assert.match(matrix, /engine, widths and interactions actually observed/, 'reports actual browser coverage');
  assert.match(matrix, /omitted checks as unverified/, 'does not claim omitted checks passed');
  assert.match(matrix, /A screenshot of a public route establishes what that route serves; it does not verify a staged draft/, 'public screenshots do not certify drafts');
  for (const [name, text] of [['ui-loop', loop], ['gstack', gstack]]) {
    assert.doesNotMatch(text, /AI Dev Shop|Web Design routing|Programmer|browser_automation/, `${name} uses host capabilities and design authority`);
    assert.match(text, /current project/, `${name} follows project rules`);
    assert.match(text, /material design decision[^]*unresolved/, `${name} limits questions to unresolved design decisions`);
  }
  assert.match(loop, /conformance checks against the approved design\/spec/, 'approved design remains the conformance target');
});

test('saves requested work and publishes only on request', async () => {
  const core = flat(await read('skills/ui-ux-design/SKILL.md'));
  assert.match(core, /Design-only requests may return in chat/, 'design consultation can stay in chat');
  assert.match(core, /Save requested page or deck work with the current host's tools/, 'requested work becomes a saved artifact');
  assert.match(core, /Publish only when requested/, 'saving does not authorize publication');
  assert.match(core, /If no save tool is available, return the artifact in chat and explain the limitation/, 'missing tools have a concrete artifact fallback');
});
