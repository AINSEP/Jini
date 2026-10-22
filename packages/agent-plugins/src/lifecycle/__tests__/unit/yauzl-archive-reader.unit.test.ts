import { test, expect } from 'vitest';
import { createYauzlAgentPluginArchiveReader, type YauzlEntry, type YauzlPort } from '../../yauzl-archive-reader.js';

// Generalizes the consumer's Unix mode and symlink characterization at the injected reader seam.
test('reader distinguishes directories, executable files and Unix symlinks, and always closes', async () => {
  let closed = 0;
  let streamed = 0;
  const entries: YauzlEntry[] = [
    { fileName: 'skills/', versionMadeBy: 3 << 8, externalFileAttributes: 0o40755 << 16, uncompressedSize: 0 },
    { fileName: 'script.sh', versionMadeBy: 3 << 8, externalFileAttributes: 0o100755 << 16, uncompressedSize: 2 },
    { fileName: 'link', versionMadeBy: 3 << 8, externalFileAttributes: 0o120777 << 16, uncompressedSize: 4 },
    { fileName: 'windows.md', versionMadeBy: 0, externalFileAttributes: 0o120777 << 16, uncompressedSize: 2 },
  ];
  const yauzl: YauzlPort = { fromBufferPromise: async (_bytes, options) => {
    expect(options).toEqual({ lazyEntries: true, validateEntrySizes: true });
    return {
      eachEntry: async function* () { yield* entries; },
      openReadStreamPromise: async () => { streamed++; return (async function* () { yield new Uint8Array([1, 2]); })(); },
      close: () => { closed++; },
    };
  } };
  const reader = createYauzlAgentPluginArchiveReader({ yauzl });
  const projected = [];
  for await (const entry of reader.entries({ archive: new Uint8Array([3]) })) {
    projected.push(entry);
    if (entry.kind === 'file') for await (const _chunk of entry.openReadStream({})) { /* consume */ }
  }
  expect(projected.map(e => e.kind)).toEqual(['directory', 'file', 'symlink', 'file']);
  expect(projected[1]).toMatchObject({ executable: true });
  expect(projected[3]).toMatchObject({ executable: false });
  expect(streamed).toBe(2);
  expect(closed).toBe(1);
});
test('entry iteration failure closes the peer archive and propagates the error', async () => {
  let closed = false;
  const error = new Error('bad archive');
  const reader = createYauzlAgentPluginArchiveReader({ yauzl: { fromBufferPromise: async () => ({
    eachEntry: async function* () { throw error; },
    openReadStreamPromise: async () => (async function* () {})(),
    close: () => { closed = true; },
  }) } });
  const consume = async () => { for await (const _entry of reader.entries({ archive: new Uint8Array() })) { /* consume */ } };
  await expect(consume()).rejects.toBe(error);
  expect(closed).toBe(true);
});

test('a directory-shaped Unix symlink is still a symlink and never streamed', async () => {
  const stream = async () => { throw new Error('symlink content must not be read'); };
  const reader = createYauzlAgentPluginArchiveReader({ yauzl: { fromBufferPromise: async () => ({
    eachEntry: async function* () { yield { fileName: 'link/', versionMadeBy: 3 << 8, externalFileAttributes: 0o120777 << 16, uncompressedSize: 0 }; },
    openReadStreamPromise: stream,
    close: () => {},
  }) } });
  const entries = [];
  for await (const entry of reader.entries({ archive: new Uint8Array() })) entries.push(entry);
  expect(entries).toEqual([{ kind: 'symlink', entryPath: 'link/' }]);
});
