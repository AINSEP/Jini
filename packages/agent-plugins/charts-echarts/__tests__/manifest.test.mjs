import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// The face ships know-how only; the folder walk below is what the assembler ships (tests excluded).
// The packed archive itself is covered by the plugin-charts-echarts pack test and Jini's
// standalone-agent-plugin integration test.
const root = path.resolve(import.meta.dirname, '..');
// Read as data, never imported: the face must name the provider it is the assistant face of.
const providerManifestPath = path.resolve(root, '../../provider-plugins/src/charts-echarts/jini.plugin.json');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const readSkill = () => readFile(path.join(root, 'skills/charts-echarts/SKILL.md'), 'utf8');

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('ships one skill and a manifest: no MCP server, no code', async () => {
  assert.deepEqual(await shippedFiles(), ['plugin.json', 'skills/charts-echarts/SKILL.md']);
});

// A face and its provider share the local name in different families; equal publisher ids are
// refused across families, so the face carries its own id (plan v2 §2.1).
test('the face links to the ECharts provider by local id and never reuses its publisher id', async () => {
  const manifest = await readJson(path.join(root, 'plugin.json'));
  const provider = await readJson(providerManifestPath);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'charts-echarts');
  assert.equal(manifest.extensions.tovu.id, 'jini/charts-echarts-agent');
  assert.equal(provider.extensions.tovu.id, 'jini/charts-echarts');
  assert.equal(manifest.extensions.tovu.providerPlugin, provider.id);
  assert.notEqual(manifest.extensions.tovu.id, provider.extensions.tovu.id);
  assert.deepEqual(Object.keys(manifest.extensions), ['tovu']);
});

test('keywords are nonempty strings that a chart request finds', async () => {
  const { keywords } = await readJson(path.join(root, 'plugin.json'));
  assert.ok(keywords.every(keyword => typeof keyword === 'string' && keyword.trim() === keyword && keyword.length > 0));
  assert.equal(new Set(keywords).size, keywords.length);
  for (const keyword of ['chart', 'graph', 'bar-chart', 'stacked-bar-chart', 'area-chart', 'donut-chart', 'scatter-plot', 'multi-series', 'chart-spec']) {
    assert.ok(keywords.includes(keyword), keyword);
  }
});

test('the skill teaches discovery, the data shapes, chart.spec and the never-paste rule in 80-120 lines', async () => {
  const skill = await readSkill();
  const lines = skill.split('\n').length;
  assert.ok(lines >= 80 && lines <= 120, `${lines} lines`);
  assert.match(skill, /^---\nname: charts-echarts\n/);
  assert.match(skill, /`search_components` with `"chart"`/);
  assert.match(skill, /`describe_component`/);
  assert.match(skill, /`chart\.spec`/);
  assert.match(skill, /\{ data: \[rows\], categoryKey, valueKey, valueLabel\?, color\? \}/);
  assert.match(skill, /`plugin\.echarts\.pie-chart`: `\{ data: \[\{ name, value \}\], color\? \}`/);
  assert.match(skill, /Never paste ECharts, SVG or HTML chart code/);
});

test('the skill lists exactly the kinds the provider declares and its pie and scatter rules', async () => {
  const skill = await readSkill();
  const provider = await readJson(providerManifestPath);
  const [declaration] = provider.browserProviders;
  const order = ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'stacked-bar'];
  assert.deepEqual([...declaration.kinds].sort(), [...order].sort());
  assert.match(skill, new RegExp(`ECharts draws ${order.map(kind => `\`${kind}\``).join(', ').replace(/, (?=[^,]*$)/, ' and ')} only`));
  assert.match(skill, new RegExp(`\`spec\\.provider: "${declaration.id.replace('.', '\\.')}"\``));
  assert.match(skill, /exactly \*\*one\*\* series/);
  assert.match(skill, /`categoryKey` is the numeric \*\*x\*\*/);
});

test('the skill example is a chart.spec the provider admits', async () => {
  const skill = await readSkill();
  const example = JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)[1]);
  const { spec } = example;
  assert.equal(spec.provider, 'plugin.echarts');
  assert.ok(spec.series.length > 1);
  for (const row of spec.data) {
    assert.equal(typeof row[spec.categoryKey], 'string');
    for (const { key } of spec.series) assert.ok(row[key] === null || Number.isFinite(row[key]), key);
  }
});

test('the shipped text is host-neutral', async () => {
  const manifest = await readJson(path.join(root, 'plugin.json'));
  const texts = [manifest.description, manifest.extensions.tovu.summary, await readSkill()];
  for (const text of texts) {
    assert.doesNotMatch(text, /\bTovu\b/);
    assert.doesNotMatch(text, /assistant_render_ui|agent_plugin_/);
  }
});
