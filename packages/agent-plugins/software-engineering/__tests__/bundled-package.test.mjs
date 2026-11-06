import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { validatePluginManifest } from '../../dist/index.js';

const root = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(root, file), 'utf8');
const skill = 'skills/software-engineering/SKILL.md';
const references = ['debugging', 'implementation', 'planning', 'prototyping', 'security', 'verification'].map(name => `skills/software-engineering/references/${name}.md`);

async function payloadFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
}

test('the standard manifest resolves as an isolated package subpath with host metadata only in extensions', async () => {
  const manifest = JSON.parse(await read('plugin.json'));
  assert.equal(validatePluginManifest({ value: manifest }), true);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'software-engineering');
  assert.deepEqual(manifest.extensions.jini, {
    id: 'jini/software-engineering', displayName: 'Software Engineering',
    summary: 'Helps write maintainable, secure, test-ready software with honest verification.',
    provides: ['software-engineering'],
  });
  const { extensions, ...portable } = manifest;
  assert.doesNotMatch(JSON.stringify(portable), /Tovu|AINSEP|tovu/);
  const resolve = createRequire(import.meta.url).resolve;
  assert.equal(resolve('@jini-ai/agent-plugins/software-engineering'), path.join(root, 'plugin.json'));
  assert.equal(resolve(`@jini-ai/agent-plugins/software-engineering/${skill}`), path.join(root, skill));
});

test('one router and exactly six references ship, and every relative Markdown link resolves inside this skill', async () => {
  const files = await payloadFiles();
  assert.deepEqual(files.filter(file => file.startsWith('skills/')), [skill, ...references].sort());
  assert.match(await read(skill), /^---\nname: software-engineering\ndescription: .+\n---/);
  for (const file of [skill, ...references]) {
    for (const [, target] of (await read(file)).matchAll(/\]\(([^)]+)\)/g)) {
      assert.doesNotMatch(target, /^https?:|^\/|\.\./);
      const resolved = path.posix.join(path.posix.dirname(file), target);
      assert.ok(files.includes(resolved), `${file}: missing ${target}`);
    }
  }
});

test('portable skill text is self-contained and has no host tooling, pipeline paths or provenance', async () => {
  for (const file of [skill, ...references]) {
    assert.doesNotMatch(await read(file), /apps\/desktop|Tovu|AINSEP|AI-Dev-Shop|ADS_MEMORY_ROOT|\/Users\/|\/workspace\/|<<PEER|session names|agent_plugin_|search_tools|describe_tool|@jini-ai\/|\.\.\//, file);
  }
  assert.deepEqual((await payloadFiles()).filter(file => !file.startsWith('skills/')), ['LICENSE', 'NOTICE', 'README.md', 'plugin.json']);
});

test('payload budgets include legal files, and README records the exact skill content hashes', async () => {
  let total = 0;
  const readme = await read('README.md');
  for (const file of await payloadFiles()) {
    const bytes = await readFile(path.join(root, file));
    total += bytes.length;
    if (file === skill) assert.ok(bytes.length <= 4096, `${file}: ${bytes.length}`);
    if (references.includes(file)) assert.ok(bytes.length <= 5120, `${file}: ${bytes.length}`);
    if (file.startsWith('skills/')) assert.ok(readme.includes(createHash('sha256').update(bytes).digest('hex')), file);
  }
  assert.ok(total <= 40 * 1024, `payload: ${total}`);
});
