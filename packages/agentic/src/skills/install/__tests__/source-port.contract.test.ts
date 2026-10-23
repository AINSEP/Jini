import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSkillInstaller, createSkillLayout, createNodeSkillFilesystem, prepareSkillInstall,
  SkillInputError, type SkillInstallDeps, type SkillSourceFetchPort, type SkillSourceValidatorPort,
} from '../index.js';

type Source = { url: string; revision: string };
const url = 'https://skills.example.test/public/incident';
const source: Source = { url, revision: 'rev-1' };
const ctx = { workspaceId: 'ws' };
const markdown = '---\nname: incident\ndescription: Respond to outages.\n---\nKeep these exact bytes.\n';
const upload = () => [{ path: 'SKILL.md', contentBase64: Buffer.from(markdown).toString('base64') }];
const validateSource: SkillSourceValidatorPort = ({ source: value }, _optional = {}) => {
  const record = value as Partial<Source> | null;
  return record?.url === url && record.revision === 'rev-1';
};

async function fixture(work: (required: {
  root: string; deps: SkillInstallDeps<Source>;
  fetchSource: ReturnType<typeof vi.fn<SkillSourceFetchPort<Source>>>;
}) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-source-'));
  const layout = createSkillLayout({ root, stagingRoot: path.join(root, 'staging'), workspaceDirectory: 'workspaces', stateFileName: '.state.json' });
  const fetchSource = vi.fn<SkillSourceFetchPort<Source>>(async () => ({ files: upload(), source }));
  const deps: SkillInstallDeps<Source> = {
    layout, filesystem: createNodeSkillFilesystem({}), fetchSource, validateSource,
    archiveReader: { open: async () => { throw new Error('unexpected archive read'); } },
    yamlReader: { read: () => ({ name: 'incident', description: 'Respond to outages.' }) },
    ids: { next: () => 'toggle-1' }, toolId: ({ name }) => `skill_${name}`,
    toolSourceLoader: { load: async () => {
      let entries;
      try { entries = await readdir(layout.resolve(ctx).workspaceRoot, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      return entries.filter(entry => entry.isDirectory()).map(entry => ({
        id: `skill_${entry.name}`, skillName: entry.name, description: 'Respond to outages.', directory: entry.name,
      }));
    } },
  };
  try { await work({ root, deps, fetchSource }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

describe('injected skill source contract', () => {
  it.each([{ url }, { githubUrl: url }])('normalizes remote input %j and commits approved bytes without refetching', input => fixture(async ({ root, deps, fetchSource }) => {
    const files = upload();
    fetchSource.mockResolvedValue({ files, source });
    const api = createSkillInstaller(deps, {});
    const prepared = await api.prepareSkillInstall({ ...ctx, ...input });
    expect(fetchSource.mock.calls).toEqual([[{ url }, {}]]);
    expect(await readdir(root)).toEqual([]);
    expect(prepared.source).toEqual(source);
    expect(prepared.files.get('SKILL.md')).toEqual(Buffer.from(markdown));
    // Mutation of the provider's upload after approval must not change committed content.
    files[0]!.contentBase64 = Buffer.from('unapproved bytes').toString('base64');
    const installed = await api.commitSkillInstall({ ...ctx, prepared });
    const directory = path.join(deps.layout.resolve(ctx).workspaceRoot, 'incident');
    expect(await readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe(markdown);
    expect(JSON.parse(await readFile(path.join(directory, '.state.json'), 'utf8'))).toEqual({ enabled: true, source });
    expect(await api.listManagedSkills(ctx)).toEqual([installed]);
    await api.setSkillEnabled({ ...ctx, toolId: installed.toolId, enabled: false });
    expect(await api.listManagedSkills(ctx)).toEqual([{ ...installed, enabled: false }]);
    expect(JSON.parse(await readFile(path.join(directory, '.state.json'), 'utf8'))).toEqual({ enabled: false, source });
    expect((await readdir(directory)).sort()).toEqual(['.state.json', 'SKILL.md']);
    await api.uninstallSkill({ ...ctx, toolId: installed.toolId });
    expect(await api.listManagedSkills(ctx)).toEqual([]);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  }));

  it('supports standalone preparation with the public ports and argument convention', () => fixture(async ({ root, deps, fetchSource }) => {
    const prepared = await prepareSkillInstall({ input: { ...ctx, url }, deps }, {});
    expect(prepared).toEqual({ toolId: 'skill_incident', name: 'incident', description: 'Respond to outages.', source, files: new Map([['SKILL.md', Buffer.from(markdown)]]) });
    expect(fetchSource.mock.calls).toEqual([[{ url }, {}]]);
    expect(await readdir(root)).toEqual([]);
  }));

  it('uses the shared file validator on provider output before writing', () => fixture(async ({ root, deps, fetchSource }) => {
    fetchSource.mockResolvedValue({ source, files: [...upload(), { path: 'references/../escape.md', contentBase64: 'eA==' }] });
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toThrow('Unsafe skill file path: references/../escape.md');
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual([]);
  }));

  it.each([new SkillInputError({ message: 'Provider refused this URL.' }), new Error('transport failed')])('preserves provider error identity and classification: %s', failure => fixture(async ({ root, deps, fetchSource }) => {
    const legacyFetch = vi.fn(async () => Response.json({}));
    deps.fetch = legacyFetch;
    fetchSource.mockRejectedValue(failure);
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toBe(failure);
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  }));

  it('requires a provider for url input even when the legacy HTTP transport exists', () => fixture(async ({ root, deps }) => {
    delete deps.fetchSource;
    const fetch = vi.fn(async () => Response.json({}));
    deps.fetch = fetch;
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toThrow('A skill source provider is required for URL installation.');
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  }));

  it('reports a missing legacy transport for githubUrl without a source provider', () => fixture(async ({ root, deps }) => {
    delete deps.fetchSource;
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, githubUrl: 'https://github.com/o/r' })).rejects.toThrow('A legacy GitHub fetch transport is required.');
    expect(await readdir(root)).toEqual([]);
  }));

  it('requires provenance validation before calling an injected provider', () => fixture(async ({ root, deps, fetchSource }) => {
    delete deps.validateSource;
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toThrow('Skill source provenance validation is required.');
    expect(fetchSource).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  }));

  it.each([null, [], 'uploaded', { url, revision: 'unapproved' }])('refuses invalid fetched provenance %j without writes', invalid => fixture(async ({ root, deps, fetchSource }) => {
    fetchSource.mockResolvedValue({ files: upload(), source: invalid as unknown as Source });
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toThrow('Invalid skill source provenance.');
    expect(await readdir(root)).toEqual([]);
  }));

  it('propagates provenance validator failure before any writes', () => fixture(async ({ root, deps }) => {
    const failure = new Error('provider validator failed');
    deps.validateSource = () => { throw failure; };
    await expect(createSkillInstaller(deps).installSkill({ ...ctx, url })).rejects.toBe(failure);
    expect(await readdir(root)).toEqual([]);
  }));

  it('does not fall back to legacy provenance when the injected validator refuses saved state', () => fixture(async ({ deps }) => {
    const api = createSkillInstaller(deps);
    await api.installSkill({ ...ctx, url });
    const statePath = path.join(deps.layout.resolve(ctx).workspaceRoot, 'incident', '.state.json');
    await writeFile(statePath, JSON.stringify({ enabled: true, source: { githubUrl: 'https://github.com/o/r', commit: 'a'.repeat(40) } }));
    await expect(api.listManagedSkills(ctx)).rejects.toThrow('Invalid skill installation record.');
    await expect(api.setSkillEnabled({ ...ctx, toolId: 'skill_incident', enabled: false })).rejects.toThrow('Invalid skill installation record.');
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ enabled: true, source: { githubUrl: 'https://github.com/o/r', commit: 'a'.repeat(40) } });
  }));

  it('leaves upload installation independent of remote source configuration', () => fixture(async ({ deps, fetchSource }) => {
    delete deps.validateSource;
    const installed = await createSkillInstaller(deps).installSkill({ ...ctx, files: upload() });
    expect(installed.source).toBe('uploaded');
    expect(fetchSource).not.toHaveBeenCalled();
  }));

  it('leaves ZIP installation independent of remote source configuration', () => fixture(async ({ deps, fetchSource }) => {
    const bytes = Buffer.from(markdown);
    deps.validateSource = () => { throw new Error('unexpected provenance validation'); };
    deps.archiveReader = { open: async () => ({
      entries: (async function* () { yield {
        path: 'SKILL.md', kind: 'file' as const, size: bytes.length,
        read: async function* () { yield bytes; },
      }; })(), close: () => {},
    }) };
    const installed = await createSkillInstaller(deps).installSkill({ ...ctx, archiveBase64: '' });
    expect(installed.source).toBe('uploaded');
    expect(fetchSource).not.toHaveBeenCalled();
  }));
});
