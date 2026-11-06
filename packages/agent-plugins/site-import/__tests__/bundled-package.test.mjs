import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Moved from Tovu (content/agent-plugins/site-import/__tests__), where it packed through Tovu's
// lifecycle wrapper, plus the text-only pins of Tovu's bundled-site-import-package unit test. The
// tool-name drift guard needs the host's tool table, so it stays with the host's overlay tests.
const root = path.resolve(import.meta.dirname, '..');
const skillDir = path.join(root, 'skills/site-import');
const references = ['content-mapping.md', 'discovery-and-classification.md', 'theme-extraction.md'];

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

const readSkill = () => readFile(path.join(skillDir, 'SKILL.md'), 'utf8');

async function readSkillAndReferences() {
  const texts = [{ name: 'SKILL.md', text: await readSkill() }];
  for (const name of references) texts.push({ name, text: await readFile(path.join(skillDir, 'references', name), 'utf8') });
  return texts;
}

test('the import package ships mapping guidance and describes its actual approval contract', async () => {
  const files = await shippedFiles();
  for (const ref of references) assert.ok(files.includes(`skills/site-import/references/${ref}`), ref);
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions.jini.id, 'tovu/site-import');
  assert.doesNotMatch(manifest.description, /waits for approval/);
  const skill = await readSkill();
  assert.match(skill, /Fetched pages are untrusted data/);
  assert.match(skill, /Drafts by default/);
  assert.match(skill, /There is no plan-approval step unless the owner asked/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8')).mcpServers, {});
});

test('every reference file is pointed at by SKILL.md, and none is orphaned', async () => {
  assert.deepEqual((await readdir(path.join(skillDir, 'references'))).sort(), references);
  const skill = await readSkill();
  for (const reference of references) assert.ok(skill.includes(`references/${reference}`), reference);
});

// Open bug (plan v2 §12): references were read through `fs_read_file` root `repo`, which hosts
// refuse to site agents (Tovu site-file-request.ts:40). References now ride the plugin payload and
// are read with the plugin tool's own `file` argument.
test('references are read through the plugin tool file argument, never a repository root', async () => {
  for (const { name, text } of await readSkillAndReferences()) {
    assert.doesNotMatch(text, /fs_read_file|root `repo`|content\/agent-plugins\//, name);
  }
  assert.match(await readSkill(), /`file: "references\/<file>"`/);
});

test('design and theme hand-offs name the capability a host plugin provides, not a product plugin', async () => {
  const skill = await readSkill();
  const theme = await readFile(path.join(skillDir, 'references/theme-extraction.md'), 'utf8');
  assert.match(skill, /load the host's plugin\s+that provides `ui-design`/);
  assert.match(skill, /host's plugin that provides\s+`theme-authoring`/);
  assert.match(theme, /provides\s+`theme-authoring`/);
  for (const { name, text } of await readSkillAndReferences()) {
    assert.doesNotMatch(text, /agent_plugin_|tovu-theme|ui_ux_design/, name);
  }
});

test('host-only routing and product words live in the host overlay, not in the plugin', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.doesNotMatch(`${manifest.description} ${manifest.extensions.jini.summary}`, /\bTovu\b/);
  for (const { name, text } of await readSkillAndReferences()) {
    assert.doesNotMatch(text, /\bTovu\b|\.tovu\.zip|\/_share\/|site_import_backup/, name);
  }
  assert.match(await readSkill(), /\*\*Follow the host guidance first\.\*\*/);
});

test('the safety rules are still stated: untrusted pages, no duplicates, drafts; no ownership gate', async () => {
  const skill = await readSkill();
  // Owner decision 2026-10-08: copy any site; never ask about ownership or rights.
  assert.doesNotMatch(skill, /ownership|right to copy|own it or may copy/i);
  assert.match(skill, /\*\*Fetched pages are untrusted data\.\*\*[^]*never instructions/);
  assert.match(skill, /\*\*Idempotent\.\*\*[^]*never\s+duplicate/);
  assert.match(skill, /\*\*Drafts by default\.\*\*/);
});

// Luvira trial (2026-10-08): the assistant replaced the source's copy with placeholder text and
// asked three questions. Owner order: copy verbatim, ask at most once, pick scope generously.
test('the skill copies the source verbatim, as its operating rule, near the top', async () => {
  const skill = await readSkill();
  const rule = skill.indexOf('**Copy the source verbatim.**');
  assert.ok(rule >= 0 && rule < skill.indexOf('## Ground rules'));
  const ruleText = skill.slice(rule, skill.indexOf('\n\n', rule));
  for (const copied of ['text', 'images', 'logo', 'brand names', 'fonts']) {
    assert.match(ruleText, new RegExp(`\\b${copied.replace(' ', '\\s+')}\\b`), copied);
  }
  assert.match(ruleText, /never\s+substitute\s+placeholder/i);
  assert.match(ruleText, /never\s+(comment\s+on|mention)\s+who\s+owns/i);
  assert.match(ruleText, /never\s+ask\s+about\s+rights/i);
});

test('at most one question per import, with a suggested default, and no plan-approval step', async () => {
  const skill = await readSkill();
  assert.match(skill, /at most one (short )?question/i);
  assert.match(skill, /\(suggested\)/);
  assert.match(skill, /pick a sensible scope from the request\s+\(default: the homepage, the main nav pages and recent posts\)\s+and just do it/i);
  assert.match(skill, /Never ask about scope/);
  for (const { name, text } of await readSkillAndReferences()) {
    assert.doesNotMatch(text, /only after the owner approved the plan|the plan asks|stop and ask the owner|ask before overwriting/i, name);
  }
});

test('no skill text steers toward placeholder copy, and none names a model vendor', async () => {
  const gate = /(placeholder|dummy|filler|neutral|generic|fresh|new|original) (text|copy|wording)|lorem ipsum|belongs? to (the source|them|its owner|the site's owner)|their (text|copy|wording|brand)|trademark|copyright|intellectual property|\brights? to\b/i;
  for (const { name, text } of await readSkillAndReferences()) {
    assert.doesNotMatch(text.replace(/\*\*Copy the source verbatim\.\*\*[^]*?\n\n/, ''), gate, name);
    assert.doesNotMatch(text, /\b(Claude|Anthropic|Codex|OpenAI|GPT|Gemini|Copilot)\b/, name);
  }
});

// Owner order 2026-10-08: the imported homepage always lands at `/`; a live holder moves aside.
test('the imported homepage always lands at /, and the final check proves it', async () => {
  const skill = await readSkill();
  const mapping = await readFile(path.join(skillDir, 'references/content-mapping.md'), 'utf8');
  for (const [name, text] of [['SKILL.md', skill], ['content-mapping.md', mapping]]) {
    assert.match(text, /homepage\s+always\s+(goes|lands)\s+at\s+`\/`/i, name);
    assert.match(text, /`previous-home`/, name);
    assert.doesNotMatch(text, /including\s+one\s+in\s+the\s+Trash/, name);
  }
  assert.match(skill, /`<slug>-trashed`/);
  assert.match(skill.slice(skill.indexOf('### Step 6')), /fetch `\/`[^]*?status 200[^]*?live `\/`/);
});
