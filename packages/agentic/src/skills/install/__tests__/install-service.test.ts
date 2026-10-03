import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createSkillInstaller } from '../install-service.js';
import { createSkillLayout } from '../layout.js';
import { createNodeSkillFilesystem } from '../node-filesystem.js';
import { validateSkillFiles } from '../validation.js';
import type { ArchiveReaderPort, SkillFetchPort, YamlReaderPort } from '../ports.js';

// Characterization cases ported from the original installation suite.
const MD = '---\nname: incident-response\ndescription: Respond to outages.\n---\nAlways check ownership.\n';
const file = (name: string, content: string) => ({ path: name, contentBase64: Buffer.from(content).toString('base64') });
const ctx = { workspaceId: 'workspace-local' };
// Fixture reader only: YAML syntax/schema enforcement belongs to the injected adapter.
const yamlReader: YamlReaderPort = { read: ({ yaml }) => {
  if ((yaml.match(/^name:/gm) ?? []).length > 1) throw new Error('duplicate key');
  return { name: yaml.match(/^name: (.*)$/m)?.[1], description: yaml.match(/^description: (.*)$/m)?.[1] };
} };
interface FixtureEntry { path: string; content: string; kind?: 'file' | 'directory' | 'other' }
const archiveReader: ArchiveReaderPort = { open: async ({ bytes }) => {
  const entries = JSON.parse(Buffer.from(bytes).toString('utf8')) as FixtureEntry[];
  return { entries: (async function* () {
    for (const entry of entries) yield {
      path: entry.path, kind: entry.kind ?? 'file', size: Buffer.byteLength(entry.content),
      read: () => (async function* () { yield Buffer.from(entry.content); })(),
    };
  })(), close: () => {} };
} };
const archive = (entries: FixtureEntry[]) => Buffer.from(JSON.stringify(entries)).toString('base64');

async function fixture(work: (api: ReturnType<typeof createSkillInstaller>, root: string) => Promise<void>, fetchImpl: SkillFetchPort = async () => { throw new Error('unexpected fetch'); }) {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-install-'));
  const layout = createSkillLayout({ root, stagingRoot: path.join(root, 'staging'), workspaceDirectory: 'tenants', stateFileName: '.host-install.json' });
  let sequence = 0;
  const api = createSkillInstaller({ layout, filesystem: createNodeSkillFilesystem({}), archiveReader, yamlReader, fetch: fetchImpl,
    ids: { next: () => `id-${++sequence}` }, toolId: ({ name }) => `skill_${name.replace(/-/g, '_')}`,
    toolSourceLoader: { load: async ({ workspaceId }) => {
      const workspace = layout.resolve({ workspaceId }).workspaceRoot;
      let entries;
      try { entries = await readdir(workspace, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      return Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const markdown = await readFile(path.join(workspace, entry.name, 'SKILL.md'), 'utf8');
        const skill = validateSkillFiles({ files: [file('SKILL.md', markdown)], yamlReader });
        return { id: `skill_${skill.name.replace(/-/g, '_')}`, skillName: skill.name, description: skill.description, directory: entry.name };
      }));
    } },
  });
  try { await work(api, root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('upload preserves exact guidance, provenance, enable state and removal under host layout', () => fixture(async (api, root) => {
  const result = await api.installSkill({ ...ctx, files: [file('folder/SKILL.md', MD), file('folder/references/check.md', 'Check this.')] });
  assert.deepEqual(result, { toolId: 'skill_incident_response', name: 'incident-response', description: 'Respond to outages.', enabled: true, source: 'uploaded' });
  const dir = path.join(root, 'tenants/workspace-local/incident-response');
  assert.equal(await readFile(path.join(dir, 'SKILL.md'), 'utf8'), MD);
  assert.deepEqual(await api.listManagedSkills(ctx), [result]);
  await api.setSkillEnabled({ ...ctx, toolId: result.toolId, enabled: false });
  assert.equal((await api.listManagedSkills(ctx))[0]!.enabled, false);
  await api.setSkillEnabled({ ...ctx, toolId: result.toolId, enabled: true });
  assert.equal((await api.listManagedSkills(ctx))[0]!.enabled, true);
  await api.uninstallSkill({ ...ctx, toolId: result.toolId });
  assert.deepEqual(await api.listManagedSkills(ctx), []);
}));

test('archive port feeds the same validator and script content is stored as data', () => fixture(async (api, root) => {
  await api.installSkill({ ...ctx, archiveBase64: archive([{ path: 'incident/SKILL.md', content: MD }, { path: 'incident/scripts/check.sh', content: 'exit 81\n' }]) });
  assert.equal(await readFile(path.join(root, 'tenants/workspace-local/incident-response/scripts/check.sh'), 'utf8'), 'exit 81\n');
}));

for (const [name, files, message] of [
  ['missing frontmatter', [file('SKILL.md', 'name: incident-response\ndescription: Nope')], 'SKILL.md must have YAML frontmatter with a name and description.'],
  ['duplicate YAML keys', [file('SKILL.md', '---\nname: a\nname: b\ndescription: Nope\n---\n')], 'SKILL.md must have valid YAML frontmatter.'],
  ['invalid name', [file('SKILL.md', MD.replace('incident-response', '../bad'))], 'Skill name must use lowercase letters, digits and single hyphens (1–64 characters).'],
  ['traversal', [file('SKILL.md', MD), file('references/../escape.md', 'bad')], 'Unsafe skill file path: references/../escape.md'],
  ['code extension', [file('SKILL.md', MD), file('assets/payload.exe', 'bad')], 'Unsupported skill file type: assets/payload.exe'],
  ['duplicate path', [file('SKILL.md', MD), file('SKILL.md', MD)], 'Duplicate skill file path: SKILL.md'],
  ['binary markdown', [file('SKILL.md', MD), file('references/check.md', '\u0000binary')], 'Skill text file must be valid UTF-8 without null bytes: references/check.md'],
  ['oversized skill', [file('SKILL.md', MD + 'a'.repeat(128 * 1024))], 'SKILL.md exceeds 128 KiB.'],
] as const) test(`rejects ${name} without any partial installation`, () => fixture(async (api) => {
  await assert.rejects(() => api.installSkill({ ...ctx, files }), { message });
  assert.deepEqual(await api.listManagedSkills(ctx), []);
}));

test('duplicate and concurrent installations preserve the original guidance', () => fixture(async (api, root) => {
  const installs = await Promise.allSettled([
    api.installSkill({ ...ctx, files: [file('SKILL.md', MD)] }),
    api.installSkill({ ...ctx, files: [file('SKILL.md', MD + 'replaced')] }),
  ]);
  assert.equal(installs[0]!.status, 'fulfilled');
  assert.equal(installs[1]!.status, 'rejected');
  await assert.rejects(() => api.installSkill({ ...ctx, files: [file('SKILL.md', MD)] }), { message: "Skill 'incident-response' is already installed. Remove it before installing another version." });
  assert.equal(await readFile(path.join(root, 'tenants/workspace-local/incident-response/SKILL.md'), 'utf8'), MD);
}));

test('archive special entries refuse before persistence', () => fixture(async api => {
  await assert.rejects(() => api.installSkill({ ...ctx, archiveBase64: archive([{ path: 'SKILL.md', content: MD }, { path: 'references/link.md', content: '/etc/passwd', kind: 'other' }]) }), { message: 'Skill archives may contain only regular files and directories.' });
  assert.deepEqual(await api.listManagedSkills(ctx), []);
}));

test('GitHub pins one immutable commit and records provenance with safe requests', async () => {
  const sha = 'a'.repeat(40), blobSha = 'b'.repeat(40), requests: string[] = [];
  const fetchImpl: SkillFetchPort = async ({ url }, init) => {
    requests.push(String(url));
    assert.equal(init!.redirect, 'error'); assert.ok(init!.signal);
    if (String(url).endsWith('/commits/HEAD')) return Response.json({ sha });
    if (String(url).endsWith(`/git/trees/${sha}?recursive=1`)) return Response.json({ truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', sha: blobSha, size: Buffer.byteLength(MD), mode: '100644' }] });
    if (String(url).endsWith(`/git/blobs/${blobSha}`)) return Response.json({ encoding: 'base64', content: Buffer.from(MD).toString('base64') });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  await fixture(async api => {
    const result = await api.installSkill({ ...ctx, githubUrl: 'https://github.com/acme/skills' });
    assert.deepEqual(result.source, { githubUrl: 'https://github.com/acme/skills', commit: sha });
    assert.deepEqual((await api.listManagedSkills(ctx))[0]!.source, result.source);
  }, fetchImpl);
  assert.equal(requests.length, 3);
});

test('GitHub SSRF URLs refuse before fetching', () => fixture(async api => {
  await assert.rejects(() => api.installSkill({ ...ctx, githubUrl: 'https://127.0.0.1/repo' }), { message: 'Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder.' });
}));

test('unreadable archive becomes a validation refusal without writes', () => fixture(async api => {
  await assert.rejects(() => api.installSkill({ ...ctx, archiveBase64: Buffer.from('not a zip').toString('base64') }), { message: 'Could not read skill ZIP. Use a valid ZIP with regular files only.' });
  assert.deepEqual(await api.listManagedSkills(ctx), []);
}));

test('aggregate cap rejects a mixed bundle before writes', () => fixture(async api => {
  const files = [file('SKILL.md', MD), ...Array.from({ length: 8 }, (_, i) => file(`references/chunk-${i}.md`, 'a'.repeat(1024 * 1024)))];
  await assert.rejects(() => api.installSkill({ ...ctx, files }), { message: 'Skill files exceed 8 MiB combined.' });
  assert.deepEqual(await api.listManagedSkills(ctx), []);
}));
