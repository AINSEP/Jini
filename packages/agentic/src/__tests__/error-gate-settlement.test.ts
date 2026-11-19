import { expect, it, vi } from 'vitest';
import { createSkillInstaller } from '../skills/install/install-service.js';

it('returns a failed install unchanged and runs the queued install once', async () => {
  const failure = new Error('skill listing refused');
  let reject!: (error: unknown) => void;
  const load = vi.fn().mockReturnValueOnce(new Promise<never>((_resolve, fail) => { reject = fail; })).mockResolvedValue([]);
  const rename = vi.fn(async () => {});
  const api = createSkillInstaller({
    layout: { resolve: () => ({ workspaceRoot: '/skills', stagingRoot: '/staging', stateFileName: '.state.json' }) },
    filesystem: { mkdir: async () => {}, mkdtemp: async () => '/staging/one', writeFile: async () => {},
      readFile: async () => new Uint8Array(), lstat: async () => ({ kind: 'directory', size: 0 }), rename, remove: async () => {} },
    archiveReader: { open: async () => { throw new Error('unused archive'); } },
    yamlReader: { read: () => ({}) }, ids: { next: () => 'id' }, toolId: ({ name }) => name,
    toolSourceLoader: { load },
  });
  const prepared = { toolId: 'skill', name: 'skill', description: 'Fixture', source: 'uploaded' as const,
    files: new Map([['SKILL.md', Buffer.from('fixture')]]) };
  const first = api.commitSkillInstall({ workspaceId: 'ws', prepared });
  const rejected = expect(first).rejects.toBe(failure);
  const second = api.commitSkillInstall({ workspaceId: 'ws', prepared });
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  reject(failure);
  await rejected;
  await expect(second).resolves.toEqual({ toolId: 'skill', name: 'skill', description: 'Fixture', source: 'uploaded', enabled: true });
  expect(load).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenCalledTimes(1);
});
