import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// The face ships know-how only; the folder walk below is what the assembler ships (tests excluded).
// The packed archive itself is covered by Jini's standalone-agent-plugin integration test.
const root = path.resolve(import.meta.dirname, '..');
// Read as data, never imported: the face must name the provider it is the assistant face of.
const providerManifestPath = path.resolve(root, '../../provider-plugins/src/charts-recharts/jini.plugin.json');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const readSkill = () => readFile(path.join(root, 'skills/charts-recharts/SKILL.md'), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('ships one skill and a manifest: no MCP server, no code', async () => {
  assert.deepEqual(await shippedFiles(), ['plugin.json', 'skills/charts-recharts/SKILL.md']);
});

// A face and its provider share the local name in different families; equal publisher ids are
// refused across families, so the face carries its own id (plan v2 §2.1).
test('the face links to the Recharts provider by local id and never reuses its publisher id', async () => {
  const manifest = await readJson(path.join(root, 'plugin.json'));
  const provider = await readJson(providerManifestPath);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'charts-recharts');
  assert.equal(manifest.extensions.jini.id, 'jini/charts-recharts-agent');
  assert.equal(manifest.extensions.jini.providerPlugin, provider.id);
  assert.notEqual(manifest.extensions.jini.id, provider.extensions.jini.id);
  assert.deepEqual(Object.keys(manifest.extensions), ['tovu']);
});

// Capability lookup and automatic-use ranking read `provides`; the name is the chart kind the
// provider already declares (browserProviders[].kind), never a second chart vocabulary.
test('the face provides the chart capability its provider draws', async () => {
  const manifest = await readJson(path.join(root, 'plugin.json'));
  const provider = await readJson(providerManifestPath);
  assert.deepEqual(manifest.extensions.jini.provides, [provider.browserProviders[0].kind]);
  assert.deepEqual(manifest.extensions.jini.provides, ['chart']);
});

test('keywords are nonempty strings that a chart request finds', async () => {
  const { keywords } = await readJson(path.join(root, 'plugin.json'));
  assert.ok(keywords.every(keyword => typeof keyword === 'string' && keyword.trim() === keyword && keyword.length > 0));
  assert.equal(new Set(keywords).size, keywords.length);
  for (const keyword of ['chart', 'graph', 'bar-chart', 'line-chart', 'pie-chart', 'chart-spec']) assert.ok(keywords.includes(keyword), keyword);
});

test('the skill teaches discovery, the data shapes, chart.spec and the never-paste rule in 80-120 lines', async () => {
  const skill = await readSkill();
  const lines = skill.split('\n').length;
  assert.ok(lines >= 80 && lines <= 120, `${lines} lines`);
  assert.match(skill, /^---\nname: charts-recharts\n/);
  assert.match(skill, /`search_components` with `"chart"`/);
  assert.match(skill, /`describe_component`/);
  assert.match(skill, /`chart\.spec`/);
  assert.match(skill, /\{ data: \[rows\], categoryKey, valueKey, valueLabel\?, color\? \}/);
  assert.match(skill, /`recharts\.pie-chart`: `\{ data: \[\{ name, value \}\], color\? \}`/);
  assert.match(skill, /Never paste Recharts, React, SVG or HTML chart code/);
});

test('the skill lists exactly the kinds the provider declares and its single-series limit', async () => {
  const skill = await readSkill();
  const provider = await readJson(providerManifestPath);
  const [declaration] = provider.browserProviders;
  assert.match(skill, new RegExp(`Recharts draws ${declaration.kinds.map(kind => `\`${kind}\``).join(', ').replace(/, (?=[^,]*$)/, ' and ')} only`));
  assert.match(skill, new RegExp(`\`spec\\.provider: "${declaration.id.replace('.', '\\.')}"\``));
  assert.match(skill, /exactly \*\*one\*\* series/);
});

test('the shipped text is host-neutral', async () => {
  const manifest = await readJson(path.join(root, 'plugin.json'));
  const texts = [manifest.description, manifest.extensions.jini.summary, await readSkill()];
  for (const text of texts) {
    assert.doesNotMatch(text, /\bTovu\b/);
    assert.doesNotMatch(text, /assistant_render_ui|agent_plugin_/);
  }
});
