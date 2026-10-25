import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createAgentPluginLifecycle } from '../../index.js';
import type { PackAgentPluginDirectoryOptional, PackedAgentPluginArchive } from '../../bundled-source-archive.js';
import type { AgentPluginArchiveReaderPort } from '../../install.js';
import type { FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';

type FakeNode = {
  kind: 'file' | 'directory' | 'symlink' | 'special'; content?: string; declaredSize?: number; readFailure?: boolean;
  /** What open() reaches when the path was swapped after the walk; defaults to this node. */
  opened?: FakeNode; ino?: number;
};
const limits = { maxEntries: 100, maxDepth: 10, maxFiles: 10, maxFileBytes: 1000, maxTotalBytes: 2000, maxArchiveBytes: 3000 };

/** Exercise the existing filesystem injection, including actual handle read lengths and closes. */
function fixture({ nodes, root = { kind: 'directory' } }: { nodes: Record<string, FakeNode>; root?: FakeNode }, _optional = {}) {
  const tree = new Map<string, FakeNode>([['/source', root]]);
  for (const [relative, node] of Object.entries(nodes)) {
    const absolute = path.join('/source', relative);
    const segments = relative.split('/');
    for (let depth = 1; depth < segments.length; depth++) tree.set(path.join('/source', ...segments.slice(0, depth)), { kind: 'directory' });
    tree.set(absolute, node);
  }
  const calls: string[] = [];
  const stats = (node: FakeNode) => ({
    isDirectory: () => node.kind === 'directory', isFile: () => node.kind === 'file',
    isSymbolicLink: () => node.kind === 'symlink', size: node.declaredSize ?? Buffer.byteLength(node.content ?? ''),
    dev: 1, ino: node.ino ?? 1,
  });
  const filesystem = {
    ...ports.filesystem,
    lstat: async (target: string) => { calls.push(`lstat:${target}`); return stats(tree.get(target)!); },
    readdir: async (target: string) => {
      calls.push(`list:${target}`);
      return [...tree.entries()].filter(([name]) => name !== target && path.dirname(name) === target)
        .map(([name, node]) => ({ name: path.basename(name), ...stats(node) }));
    },
    readFile: async (target: string) => { calls.push(`readFile:${target}`); return Buffer.from(tree.get(target)!.content ?? ''); },
    open: async (target: string) => {
      calls.push(`open:${target}`);
      const node = tree.get(target)!.opened ?? tree.get(target)!;
      const content = Buffer.from(node.content ?? '');
      let offset = 0;
      return {
        stat: async () => stats(node),
        read: async (buffer: Buffer, _offset: number, length: number) => {
          calls.push(`read:${target}:${length}`);
          if (node.readFailure) throw new Error('read failed');
          const bytesRead = content.copy(buffer, 0, offset, offset + length);
          offset += bytesRead;
          return { bytesRead, buffer };
        },
        close: async () => { calls.push(`close:${target}`); },
      };
    },
  } as unknown as FilesystemPort;
  return { api: createAgentPluginLifecycle({ ...ports, filesystem }), calls };
}

async function readFiles({ packed, reader = packed.archiveReader! }: {
  packed: PackedAgentPluginArchive; reader?: AgentPluginArchiveReaderPort;
}, _optional = {}): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const entry of reader.entries({ archive: packed.bytes })) {
    if (entry.kind !== 'file') throw new Error('unexpected entry kind');
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.openReadStream({})) chunks.push(chunk);
    files[entry.entryPath] = Buffer.concat(chunks).toString();
  }
  return files;
}

describe('opt-in source packing', () => {
  test('allowlist subtrees deduplicate, exclusions win, and unrelated directories are never entered', async () => {
    const { api, calls } = fixture({ nodes: {
      '__tests__': { kind: 'file', content: 'runtime file' },
      'keep/a.txt': { kind: 'file', content: 'a' }, 'keep/drop/secret': { kind: 'file', content: 'secret' },
      'keep/a.test.ts': { kind: 'file', content: 'test' }, 'other/no.txt': { kind: 'file', content: 'no' },
    } });
    const baseline = await api.packAgentPluginDirectory({ sourceDir: '/source' });
    expect(baseline.files).toEqual(['__tests__', 'keep/a.txt', 'keep/drop/secret', 'other/no.txt']);
    calls.length = 0;
    const packed = await api.packAgentPluginDirectory({ sourceDir: '/source' }, {
      allowPaths: ['keep/', 'keep\\a.txt'], excludeNames: ['drop'], limits,
    });
    expect(packed.files).toEqual(['keep/a.txt']);
    expect(await readFiles({ packed, reader: api.createBundledSourceArchiveReader({}) })).toEqual({ 'keep/a.txt': 'a' });
    expect(calls.filter(call => call.startsWith('list:'))).toEqual(['list:/source', 'list:/source/keep']);
    expect(calls.filter(call => call.startsWith('open:'))).toEqual(['open:/source/keep/a.txt']);
    const empty = await api.packAgentPluginDirectory({ sourceDir: '/source' }, { allowPaths: [] });
    expect(await readFiles({ packed: empty, reader: api.createBundledSourceArchiveReader({}) })).toEqual({});
  });

  test('default bytes remain identical, including when selecting bundled-v1 explicitly', async () => {
    const { api } = fixture({ nodes: { 'a.txt': { kind: 'file', content: 'é' } } });
    const expected = Buffer.from(`${ports.bundledArchiveMagic}F 5 2\na.txté`);
    const baseline = await api.packAgentPluginDirectory({ sourceDir: '/source' });
    const bounded = await api.packAgentPluginDirectory({ sourceDir: '/source' }, { digestEncoding: 'bundled-v1', limits });
    expect(Buffer.from(baseline.bytes)).toEqual(expected);
    expect(bounded).toEqual(baseline);
    expect(baseline.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(baseline.archiveReader).toBeUndefined();
  });

  test('canonical identity hashes sorted UTF-8 path/length/content records and binds the reader to its token', async () => {
    const nodes: Record<string, FakeNode> = { z: { kind: 'file', content: '' }, a: { kind: 'file', content: 'é' } };
    const { api } = fixture({ nodes });
    const packed = await api.packAgentPluginDirectory({ sourceDir: '/source' }, { digestEncoding: 'canonical-files-v1', limits });
    nodes.a!.content = 'changed after packing';
    // Independent vector: UTF-8(["a",2]) + UTF-8(é) + UTF-8(["z",0]); no separators or magic.
    const token = createHash('sha256').update(Buffer.from('["a",2]é["z",0]', 'utf8')).digest();
    expect(Buffer.from(packed.bytes)).toEqual(token);
    expect(packed.sha256).toBe(createHash('sha256').update(token).digest('hex'));
    expect(await readFiles({ packed })).toEqual({ a: 'é', z: '' });
    await expect(readFiles({ packed: { ...packed, bytes: new Uint8Array(32) } })).rejects.toThrow('snapshot token mismatch');
    for await (const entry of packed.archiveReader!.entries({ archive: packed.bytes })) {
      if (entry.kind === 'file') for await (const chunk of entry.openReadStream({})) chunk.fill(0);
    }
    expect(await readFiles({ packed })).toEqual({ a: 'é', z: '' });
  });

  test('rejects unsafe selections and invalid limits before filesystem I/O', async () => {
    const { api, calls } = fixture({ nodes: {} });
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits: { ...limits, maxFiles: value } })).rejects.toThrow('Invalid packing limit maxFiles');
    }
    for (const allowPath of ['../escape', '/absolute', 'C:\\absolute']) {
      await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { allowPaths: [allowPath] })).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  test.each(['maxEntries', 'maxDepth', 'maxFiles'] as const)('%s stops traversal before opening files', async name => {
    const { api, calls } = fixture({ nodes: { 'nested/a': { kind: 'file', content: 'a' }, 'later/b': { kind: 'file', content: 'b' } } });
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits: { ...limits, [name]: 0 } })).rejects.toThrow(name);
    expect(calls.some(call => call.startsWith('open:') || call.startsWith('readFile:'))).toBe(false);
    expect(calls).not.toContain('list:/source/later');
    if (name !== 'maxFiles') expect(calls).toEqual(['list:/source']);
  });

  test.each(['maxFileBytes', 'maxTotalBytes', 'maxArchiveBytes'] as const)('%s accounts for growing files and closes before opening later files', async name => {
    const { api, calls } = fixture({ nodes: {
      a: { kind: 'file', content: '12345', declaredSize: 1 }, b: { kind: 'file', content: 'later' },
    } });
    const cap = name === 'maxArchiveBytes' ? Buffer.byteLength(ports.bundledArchiveMagic) + Buffer.byteLength('F 1 1\na') + 4 : 4;
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits: { ...limits, [name]: cap } })).rejects.toThrow(name);
    expect(calls.filter(call => call.startsWith('open:'))).toEqual(['open:/source/a']);
    expect(calls.at(-1)).toBe('close:/source/a');
    expect(calls.some(call => call.startsWith('readFile:'))).toBe(false);
  });

  test('enforces cumulative byte limits, closes failed reads, and admits exact boundary sizes', async () => {
    const { api, calls } = fixture({ nodes: { a: { kind: 'file', content: '123' }, b: { kind: 'file', content: '45' } } });
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits: { ...limits, maxTotalBytes: 4 } })).rejects.toThrow('maxTotalBytes');
    expect(calls.at(-1)).toBe('close:/source/b');
    expect(calls.some(call => call.startsWith('read:/source/b:'))).toBe(false);
    const exact = await api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits: { ...limits, maxFileBytes: 3, maxTotalBytes: 5 } });
    expect(await readFiles({ packed: exact, reader: api.createBundledSourceArchiveReader({}) })).toEqual({ a: '123', b: '45' });
    expect(calls.filter(call => call.startsWith('close:')).map(call => call.slice(6)))
      .toEqual(calls.filter(call => call.startsWith('open:')).map(call => call.slice(5)));
    const failing = fixture({ nodes: { a: { kind: 'file', readFailure: true } } });
    await expect(failing.api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits })).rejects.toThrow('read failed');
    expect(failing.calls.at(-1)).toBe('close:/source/a');
  });

  test.each(['symlink', 'special'] as const)('selected %s entries and roots honor skip/reject without being read', async kind => {
    const option: PackAgentPluginDirectoryOptional = kind === 'symlink' ? { symlinkPolicy: 'reject' } : { specialFilePolicy: 'reject' };
    const { api, calls } = fixture({ nodes: { unsafe: { kind }, safe: { kind: 'file', content: 'safe' } } });
    expect((await api.packAgentPluginDirectory({ sourceDir: '/source' })).files).toEqual(['safe']);
    calls.length = 0;
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, option)).rejects.toThrow(kind === 'symlink' ? 'symlink' : 'special file');
    expect(calls.some(call => call.startsWith('open:') || call.startsWith('readFile:'))).toBe(false);
    expect((await api.packAgentPluginDirectory({ sourceDir: '/source' }, { ...option, excludeNames: ['unsafe'] })).files).toEqual(['safe']);
    const root = fixture({ nodes: {}, root: { kind } });
    await expect(root.api.packAgentPluginDirectory({ sourceDir: '/source' }, option)).rejects.toThrow();
    expect(root.calls.some(call => call.startsWith('list:'))).toBe(false);
  });

  test('a symlinked root keeps legacy output under any non-reject options object', async () => {
    const { api } = fixture({ nodes: { 'a.txt': { kind: 'file', content: 'a' } }, root: { kind: 'symlink' } });
    const baseline = await api.packAgentPluginDirectory({ sourceDir: '/source' });
    // An explicit undefined field reaches here from JavaScript or a spread of unset host config.
    const all: PackAgentPluginDirectoryOptional[] = [{ digestEncoding: undefined } as unknown as PackAgentPluginDirectoryOptional, { limits }, { specialFilePolicy: 'reject' }];
    for (const options of all) {
      expect(await api.packAgentPluginDirectory({ sourceDir: '/source' }, options)).toEqual(baseline);
    }
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { symlinkPolicy: 'reject' })).rejects.toThrow('symlink');
  });

  test('an allowPaths directory with a trailing slash selects its subtree', async () => {
    const { api } = fixture({ nodes: { 'dist/a.js': { kind: 'file', content: 'a' }, 'src/b.ts': { kind: 'file', content: 'b' } } });
    expect((await api.packAgentPluginDirectory({ sourceDir: '/source' }, { allowPaths: ['dist/'] })).files).toEqual(['dist/a.js']);
  });

  test('refuses a file swapped after the walk even without O_NOFOLLOW, closing the handle', async () => {
    const { api, calls } = fixture({ nodes: { a: { kind: 'file', content: 'a', opened: { kind: 'file', content: 'outside', ino: 2 } } } });
    await expect(api.packAgentPluginDirectory({ sourceDir: '/source' }, { limits })).rejects.toThrow('no longer a regular file');
    expect(calls.some(call => call.startsWith('read:'))).toBe(false);
    expect(calls.at(-1)).toBe('close:/source/a');
  });
});
