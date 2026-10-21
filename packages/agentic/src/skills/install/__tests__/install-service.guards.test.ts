import { describe, expect, it } from 'vitest';
import { createSkillInstaller } from '../install-service.js';
import type { SkillFilesystemPort, SkillInstallDeps, SkillToolSource } from '../ports.js';
import { SkillInputError } from '../validation.js';

/** In-memory lstat-only filesystem: each path maps to a kind; anything else is ENOENT. */
function memoryFilesystem(kinds: Record<string, 'file' | 'directory' | 'symlink' | 'other'>): SkillFilesystemPort & { writes: string[] } {
  const writes: string[] = [];
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  return {
    writes,
    async mkdir() {},
    async mkdtemp({ prefix }) { return `${prefix}tmp`; },
    async writeFile({ path }) { writes.push(path); },
    async readFile() { throw missing(); },
    async lstat({ path }) {
      const kind = kinds[path];
      if (!kind) throw missing();
      return { kind, size: 0 };
    },
    async rename() {},
    async remove() {},
  };
}

function installer({ layout = { workspaceRoot: '/skills/ws', stagingRoot: '/skills/staging', stateFileName: '.state.json' }, sources = [] as SkillToolSource[], kinds = {} as Record<string, 'file' | 'directory' | 'symlink' | 'other'>, nextId = 'id-1' } = {}) {
  const filesystem = memoryFilesystem(kinds);
  const deps: SkillInstallDeps = {
    layout: { resolve: () => layout },
    filesystem,
    archiveReader: { open: async () => { throw new Error('unused'); } },
    yamlReader: { read: () => ({}) },
    fetch: async () => { throw new Error('unused'); },
    ids: { next: () => nextId },
    toolId: ({ name }) => `skill_${name}`,
    toolSourceLoader: { load: async () => sources },
  };
  return { api: createSkillInstaller(deps), filesystem };
}

const ws = { workspaceId: 'ws' };
const source: SkillToolSource = { id: 'skill_a', skillName: 'a', description: 'A skill.', directory: 'a' };

describe('skill installer refuses unsafe host configuration and inputs', () => {
  it.each([
    { name: 'a relative workspace root', layout: { workspaceRoot: 'skills/ws', stagingRoot: '/skills/staging', stateFileName: '.state.json' }, message: 'Skill roots must be absolute.' },
    { name: 'a relative staging root', layout: { workspaceRoot: '/skills/ws', stagingRoot: 'staging', stateFileName: '.state.json' }, message: 'Skill roots must be absolute.' },
    { name: 'an empty state file name', layout: { workspaceRoot: '/skills/ws', stagingRoot: '/skills/staging', stateFileName: '' }, message: 'Invalid skill state file name.' },
    { name: 'a state file name with a separator', layout: { workspaceRoot: '/skills/ws', stagingRoot: '/skills/staging', stateFileName: 'nested/state.json' }, message: 'Invalid skill state file name.' },
    { name: 'a dot-dot state file name', layout: { workspaceRoot: '/skills/ws', stagingRoot: '/skills/staging', stateFileName: '..' }, message: 'Invalid skill state file name.' },
    { name: 'a state file name that would shadow SKILL.md', layout: { workspaceRoot: '/skills/ws', stagingRoot: '/skills/staging', stateFileName: 'SKILL.md' }, message: 'Invalid skill state file name.' },
  ])('rejects $name before touching the filesystem', async ({ layout, message }) => {
    const { api } = installer({ layout });
    await expect(api.listManagedSkills(ws)).rejects.toThrow(new SkillInputError({ message }));
  });

  it('rejects a non-boolean enabled flag from an untyped caller', async () => {
    const { api } = installer({ sources: [source], kinds: { '/skills/ws/a': 'directory' } });
    await expect(api.setSkillEnabled({ ...ws, toolId: 'skill_a', enabled: 'yes' as unknown as boolean })).rejects.toThrow('enabled must be a boolean.');
  });

  it('reports an unknown tool id as not found', async () => {
    const { api } = installer({ sources: [source], kinds: { '/skills/ws/a': 'directory' } });
    await expect(api.uninstallSkill({ ...ws, toolId: 'skill_missing' })).rejects.toThrow('Skill was not found.');
  });

  it('refuses to toggle or remove a skill whose directory is a symlink', async () => {
    const { api } = installer({ sources: [source], kinds: { '/skills/ws/a': 'symlink' } });
    await expect(api.uninstallSkill({ ...ws, toolId: 'skill_a' })).rejects.toThrow('Skill directory must be a regular directory.');
  });

  it.each(['..', '.', '', 'a/b', 'a\\b'])('refuses a tool source directory %j that is not one safe segment', async directory => {
    const { api } = installer({ sources: [{ ...source, directory }] });
    await expect(api.listManagedSkills(ws)).rejects.toThrow('Skill directory must be one safe segment.');
  });

  it.each(['', 'x/y'])('refuses an id generator that returns %j before writing any temporary state', async nextId => {
    const { api, filesystem } = installer({ sources: [source], kinds: { '/skills/ws/a': 'directory' }, nextId });
    await expect(api.setSkillEnabled({ ...ws, toolId: 'skill_a', enabled: false })).rejects.toThrow('Invalid skill temporary id.');
    expect(filesystem.writes).toEqual([]);
  });
});
