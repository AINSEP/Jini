import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { createSkillInstaller } from '../install-service.js';
import { createNodeSkillFilesystem } from '../node-filesystem.js';
import { readSkillState, SKILL_STATE_FILE_NAME } from '../state.js';

/**
 * @file The neutral state-file name and the host's legacy names. The engine owns
 * `SKILL_STATE_FILE_NAME`; a host that shipped under another name passes it as
 * `legacyStateFileNames`. Read order is new name, then legacy; every write uses the new name.
 */

const LEGACY = '.legacy-install.json';
const source = { githubUrl: 'https://github.com/acme/skills', commit: 'a'.repeat(40) };
const filesystem = createNodeSkillFilesystem({});
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function skillDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-state-legacy-'));
  roots.push(root);
  return { root, directory: path.join(root, 'incident-response') };
}
async function seed({ directory, files }: { directory: string; files: Record<string, unknown> }) {
  await filesystem.mkdir({ path: directory });
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(directory, name), JSON.stringify(value));
}
function installer({ root, legacyStateFileNames }: { root: string; legacyStateFileNames: readonly string[] }) {
  let sequence = 0;
  return createSkillInstaller({
    filesystem,
    layout: { resolve: () => ({ workspaceRoot: root, stagingRoot: path.join(root, 'staging'), stateFileName: SKILL_STATE_FILE_NAME, legacyStateFileNames }) },
    ids: { next: () => `id-${++sequence}` },
    toolId: ({ name }) => `skill_${name.replace(/-/g, '_')}`,
    toolSourceLoader: { load: async () => [{ id: 'skill_incident_response', skillName: 'incident-response', description: 'Respond to outages.', directory: 'incident-response' }] },
    archiveReader: { open: async () => { throw new Error('unexpected archive'); } },
    yamlReader: { read: () => { throw new Error('unexpected YAML'); } },
    fetch: async () => { throw new Error('unexpected fetch'); },
  }, { onChanged: () => {} });
}

test('the engine owns a neutral state file name with no host identity', () => {
  assert.equal(SKILL_STATE_FILE_NAME, '.skill-install.json');
});

test('a site with only the legacy file keeps its install record and a disabled skill stays disabled', async () => {
  const { directory } = await skillDirectory();
  await seed({ directory, files: { [LEGACY]: { enabled: false, source } } });
  assert.deepEqual(await readSkillState({ directory, stateFileName: SKILL_STATE_FILE_NAME, legacyStateFileNames: [LEGACY], filesystem }), { enabled: false, source });
});

test('without legacy names the legacy file is not consulted', async () => {
  const { directory } = await skillDirectory();
  await seed({ directory, files: { [LEGACY]: { enabled: false, source } } });
  assert.deepEqual(await readSkillState({ directory, stateFileName: SKILL_STATE_FILE_NAME, filesystem }), { enabled: true, source: 'uploaded' });
});

test('when both files exist the new file wins, even over a legacy file that says otherwise', async () => {
  const { directory } = await skillDirectory();
  await seed({ directory, files: { [LEGACY]: { enabled: false, source }, [SKILL_STATE_FILE_NAME]: { enabled: true, source: 'uploaded' } } });
  assert.deepEqual(await readSkillState({ directory, stateFileName: SKILL_STATE_FILE_NAME, legacyStateFileNames: [LEGACY], filesystem }), { enabled: true, source: 'uploaded' });
});

test('a broken new file fails closed instead of falling back to the legacy file', async () => {
  const { directory } = await skillDirectory();
  await seed({ directory, files: { [LEGACY]: { enabled: true, source }, [SKILL_STATE_FILE_NAME]: { enabled: 'yes' } } });
  await assert.rejects(readSkillState({ directory, stateFileName: SKILL_STATE_FILE_NAME, legacyStateFileNames: [LEGACY], filesystem }), /Invalid skill installation record/);
});

test('legacy names are tried in order after the new name', async () => {
  const { directory } = await skillDirectory();
  await seed({ directory, files: { '.old-b.json': { enabled: false, source: 'uploaded' }, '.old-a.json': { enabled: true, source: 'uploaded' } } });
  assert.deepEqual(await readSkillState({ directory, stateFileName: SKILL_STATE_FILE_NAME, legacyStateFileNames: ['.old-a.json', '.old-b.json'], filesystem }), { enabled: true, source: 'uploaded' });
});

test('after a write the new file exists with the same content and is authoritative; the legacy file is left alone', async () => {
  const { root, directory } = await skillDirectory();
  await seed({ directory, files: { [LEGACY]: { enabled: true, source } } });
  const api = installer({ root, legacyStateFileNames: [LEGACY] });
  await api.setSkillEnabled({ workspaceId: 'workspace-local', toolId: 'skill_incident_response', enabled: false });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, SKILL_STATE_FILE_NAME), 'utf8')), { enabled: false, source });
  assert.deepEqual((await readdir(directory)).sort(), [LEGACY, SKILL_STATE_FILE_NAME].sort());
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, LEGACY), 'utf8')), { enabled: true, source });
  // Re-enabling reads the new file, not the stale legacy one, and still writes the new file.
  await api.setSkillEnabled({ workspaceId: 'workspace-local', toolId: 'skill_incident_response', enabled: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, SKILL_STATE_FILE_NAME), 'utf8')), { enabled: true, source });
});

test('a layout that carries a malformed legacy file name is refused', async () => {
  const { root, directory } = await skillDirectory();
  await seed({ directory, files: {} });
  for (const bad of ['', 'a/b', '..', 'SKILL.md']) {
    const api = installer({ root, legacyStateFileNames: [bad] });
    await assert.rejects(api.setSkillEnabled({ workspaceId: 'workspace-local', toolId: 'skill_incident_response', enabled: false }), /Invalid skill state file name/, JSON.stringify(bad));
  }
});
