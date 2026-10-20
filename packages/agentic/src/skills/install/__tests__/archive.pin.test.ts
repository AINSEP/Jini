// Characterization pins for readSkillArchive: every refusal keeps its exact message and the
// reader is always closed once it was opened, whichever branch ends the walk.
import { describe, expect, it } from 'vitest';
import { readSkillArchive } from '../archive.js';
import { MAX_SKILL_FILE_BYTES, SkillInputError } from '../validation.js';
import type { ArchiveEntry, ArchiveReaderPort } from '../ports.js';

const GENERIC = 'Could not read skill ZIP. Use a valid ZIP with regular files only.';
const MiB = 1024 * 1024;

function entry(path: string, kind: ArchiveEntry['kind'], size: number, chunks: Uint8Array[] = []): ArchiveEntry & { opened: number } {
  const result = { path, kind, size, opened: 0, read: async function* () { result.opened++; yield* chunks; } };
  return result;
}
function fileEntry(path: string, content: string) { return entry(path, 'file', Buffer.byteLength(content), [Buffer.from(content)]); }

function reader(entries: ArchiveEntry[], options: { throwAfter?: Error } = {}) {
  const state = { closed: 0, opened: [] as Uint8Array[] };
  const port: ArchiveReaderPort = {
    open: async ({ bytes }) => {
      state.opened.push(bytes);
      return {
        entries: (async function* () { yield* entries; if (options.throwAfter) throw options.throwAfter; })(),
        close: () => { state.closed++; },
      };
    },
  };
  return { port, state };
}

async function refusal(entries: ArchiveEntry[], options: { throwAfter?: Error } = {}) {
  const { port, state } = reader(entries, options);
  const error = await readSkillArchive({ base64: '', archiveReader: port }).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SkillInputError);
  return { message: (error as SkillInputError).message, closed: state.closed };
}

describe('readSkillArchive success', () => {
  it('returns regular files in order with base64 content and skips directories', async () => {
    const { port, state } = reader([entry('folder/', 'directory', 0), fileEntry('folder/SKILL.md', 'hello'), fileEntry('folder/references/a.md', '')]);
    const files = await readSkillArchive({ base64: Buffer.from('zip').toString('base64'), archiveReader: port });
    expect(files).toEqual([
      { path: 'folder/SKILL.md', contentBase64: Buffer.from('hello').toString('base64') },
      { path: 'folder/references/a.md', contentBase64: '' },
    ]);
    expect(Buffer.from(state.opened[0]!).toString()).toBe('zip');
    expect(state.closed).toBe(1);
  });

  it('concatenates multiple streamed chunks of one file', async () => {
    const { port } = reader([entry('SKILL.md', 'file', 4, [Buffer.from('ab'), new Uint8Array([99, 100])])]);
    expect(await readSkillArchive({ base64: '', archiveReader: port })).toEqual([{ path: 'SKILL.md', contentBase64: Buffer.from('abcd').toString('base64') }]);
  });

  it('accepts exactly 256 entries and a file of exactly 1 MiB', async () => {
    const entries = [entry('big.md', 'file', MiB, [Buffer.alloc(MiB)]), ...Array.from({ length: 255 }, (_, i) => entry(`d${i}/`, 'directory', 0))];
    const { port } = reader(entries);
    expect(await readSkillArchive({ base64: '', archiveReader: port })).toHaveLength(1);
  });
});

describe('readSkillArchive refusals', () => {
  it('passes base64 refusals through without opening the archive', async () => {
    const { port, state } = reader([]);
    await expect(readSkillArchive({ base64: '***', archiveReader: port })).rejects.toThrow('Skill upload must use valid base64.');
    expect(state.opened).toEqual([]);
  });

  it('turns an open failure into the generic ZIP refusal', async () => {
    const port: ArchiveReaderPort = { open: async () => { throw new Error('bad central directory'); } };
    await expect(readSkillArchive({ base64: '', archiveReader: port })).rejects.toThrow(GENERIC);
  });

  it('turns an entry iteration failure into the generic ZIP refusal and closes', async () => {
    expect(await refusal([fileEntry('SKILL.md', 'a')], { throwAfter: new Error('crc mismatch') })).toEqual({ message: GENERIC, closed: 1 });
  });

  it('turns an entry stream failure into the generic ZIP refusal and closes', async () => {
    const broken: ArchiveEntry = { path: 'SKILL.md', kind: 'file', size: 1, read: async function* () { throw new Error('inflate failed'); } };
    expect(await refusal([broken])).toEqual({ message: GENERIC, closed: 1 });
  });

  it('refuses the 257th entry', async () => {
    const entries = Array.from({ length: 257 }, (_, i) => entry(`d${i}/`, 'directory', 0));
    expect(await refusal(entries)).toEqual({ message: 'A skill archive may contain at most 256 entries.', closed: 1 });
  });

  it.each(['../outside', '/absolute.md', 'references\\escape.md', 'a/./b.md', '.hidden', 'a//b', 'c:drive.md', 'x\u0000y'])('refuses unsafe entry path %j before reading it', async path => {
    const unsafe = entry(path, 'file', 1, [Buffer.from('a')]);
    expect(await refusal([unsafe])).toEqual({ message: `Unsafe skill file path: ${path}`, closed: 1 });
    expect(unsafe.opened).toBe(0);
  });

  it('strips only one trailing slash before validating a path', async () => {
    expect(await refusal([entry('dir//', 'directory', 0)])).toEqual({ message: 'Unsafe skill file path: dir/', closed: 1 });
  });

  it('checks the path before the entry kind', async () => {
    expect(await refusal([entry('../link', 'other', 0)])).toEqual({ message: 'Unsafe skill file path: ../link', closed: 1 });
  });

  it('refuses symlinks and other non-regular entries', async () => {
    expect(await refusal([entry('link.md', 'other', 0)])).toEqual({ message: 'Skill archives may contain only regular files and directories.', closed: 1 });
  });

  it.each([Number.NaN, 1.5, -1, MiB + 1, Number.MAX_SAFE_INTEGER + 1])('refuses declared size %s before reading', async size => {
    const sized = entry('SKILL.md', 'file', size);
    expect(await refusal([sized])).toEqual({ message: 'Skill archive file exceeds 1 MiB.', closed: 1 });
    expect(sized.opened).toBe(0);
  });

  it('refuses a stream that exceeds 1 MiB despite smaller metadata', async () => {
    expect(await refusal([entry('SKILL.md', 'file', 1, [Buffer.alloc(MiB + 1)])])).toEqual({ message: 'Skill archive exceeds its decompressed size limit.', closed: 1 });
  });

  it('refuses once the combined decompressed size passes 8 MiB', async () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry(`f${i}.md`, 'file', MAX_SKILL_FILE_BYTES, [Buffer.alloc(MAX_SKILL_FILE_BYTES)]));
    expect(await refusal(entries)).toEqual({ message: 'Skill archive exceeds its decompressed size limit.', closed: 1 });
    expect((entries[8] as ReturnType<typeof entry>).opened).toBe(1);
  });

  it('refuses a stream shorter than its metadata', async () => {
    expect(await refusal([entry('SKILL.md', 'file', 4, [Buffer.from('abc')])])).toEqual({ message: 'Skill archive file size does not match its metadata.', closed: 1 });
  });
});
