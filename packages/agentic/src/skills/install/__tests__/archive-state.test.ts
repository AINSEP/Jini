import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readSkillArchive } from '../archive.js';
import { readSkillState } from '../state.js';
import type { ArchiveEntry, FilesystemPort } from '../ports.js';

test('archive closes after traversal or streamed size refusal', async () => {
  for (const entry of [
    { path: '../outside', kind: 'file', size: 0, read: async function* () {} },
    { path: 'SKILL.md', kind: 'file', size: 1, read: async function* () { yield Buffer.alloc(1024 * 1024 + 1); } },
    { path: 'SKILL.md', kind: 'file', size: 4, read: async function* () { yield Buffer.from('abc'); } },
  ] as ArchiveEntry[]) {
    let closed = 0;
    await assert.rejects(() => readSkillArchive({ base64: '', archiveReader: { open: async () => ({ entries: (async function* () { yield entry; })(), close: () => { closed++; } }) } }));
    assert.equal(closed, 1);
  }
});

test('archive counts directory entries toward the limit and closes on refusal', async () => {
  let closed = 0;
  await assert.rejects(() => readSkillArchive({ base64: '', archiveReader: { open: async () => ({
    entries: (async function* () { for (let i = 0; i < 257; i++) yield { path: `folder-${i}/`, kind: 'directory' as const, size: 0, read: async function* () {} }; })(),
    close: () => { closed++; },
  }) } }), /at most 256 entries/);
  assert.equal(closed, 1);
});

function filesystem(read: () => Promise<Uint8Array>, stat: FilesystemPort['lstat'] = async () => ({ kind: 'file', size: 2 })): FilesystemPort {
  const unused = async (): Promise<never> => { throw new Error('unexpected write'); };
  return { mkdir: unused, mkdtemp: unused, lstat: stat, readFile: read, writeFile: unused, rename: unused, remove: unused };
}
test('missing legacy state defaults enabled; corrupt and symlink state fail closed', async () => {
  const args = { directory: '/skills/example', stateFileName: '.host-install.json' };
  assert.deepEqual(await readSkillState({ ...args, filesystem: filesystem(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }) }), { enabled: true, source: 'uploaded' });
  for (const content of ['null', '[]', '{"enabled":"yes","source":"uploaded"}', '{"enabled":true,"source":null}', '{']) {
    await assert.rejects(() => readSkillState({ ...args, filesystem: filesystem(async () => Buffer.from(content)) }));
  }
  let reads = 0;
  await assert.rejects(() => readSkillState({ ...args, filesystem: filesystem(async () => { reads++; return Buffer.from('{}'); }, async () => ({ kind: 'symlink', size: 2 })) }), /Invalid skill installation record/);
  assert.equal(reads, 0);
});
