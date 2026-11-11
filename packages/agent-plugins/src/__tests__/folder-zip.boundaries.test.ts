/**
 * @file Exact edges of the folder zippers and the MCP manifest guard: total size at the limit and one
 * byte over (browser and local), the UTF-8 name flag at 0x7f vs 0x80, a leading-slash relative path,
 * the local entry cap, the stable entry order of a local folder, and `isMcpManifest` on null/arrays.
 * Closes Stryker run-2 part-3a survivors at folder-zip.ts:51,86, folder-zip-node.ts:44,71 and
 * manifest.ts:78,80. folder-zip.ts:73 and folder-zip-node.ts:20 (raw-size `>` → `>=`) are equivalent:
 * the final zip-size check refuses the equality case with the same error. folder-zip.ts:30 (`n < 256` → `<=` in the CRC table) is equivalent: index 256
 * of a 256-entry Uint32Array is silently ignored.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FOLDER_MAX_FILES, FolderZipError, zipFolderFiles } from '../folder-zip.js';
import { zipLocalFolder } from '../folder-zip-node.js';
import { isMcpManifest } from '../manifest.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function picked(relative: string, content: string): File {
  const file = new File([content], path.posix.basename(relative));
  Object.defineProperty(file, 'webkitRelativePath', { value: relative });
  return file;
}
/** Central-directory entries of a stored zip: [name, general-purpose flags]. */
function entries(bytes: Uint8Array): Array<[string, number]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Array<[string, number]> = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const length = view.getUint16(i + 28, true);
    out.push([new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + length)), view.getUint16(i + 8, true)]);
    i += 45 + length;
  }
  return out;
}
const zipBytes = async (files: File[], maxBytes = 1_000) => new Uint8Array(await (await zipFolderFiles({ files, maxBytes })).arrayBuffer());

describe('zipFolderFiles', () => {
  // The raw-size pre-check (`> maxBytes`, line 73) cannot be pinned at equality: a zip is always larger
  // than its raw bytes, so the final size check refuses that case with the same error (equivalent mutant).
  test('a zip of exactly maxBytes is returned; one byte less refuses it as too-large', async () => {
    // 'a.txt' + 'abc': local header 30+5, data 3, central header 46+5, end record 22 = 111 bytes.
    const zipped = await zipFolderFiles({ files: [picked('f/a.txt', 'abc')], maxBytes: 111 });
    expect(zipped.size).toBe(111);
    expect(zipped.name).toBe('f.zip');
    await expect(zipFolderFiles({ files: [picked('f/a.txt', 'abc')], maxBytes: 110 })).rejects.toMatchObject({ reason: 'too-large' });
  });

  test('the UTF-8 name flag is set from byte 0x80 up, not for 0x7f', async () => {
    expect(entries(await zipBytes([picked('f/a\u007f.txt', 'x'), picked('f/é.txt', 'y')]))).toEqual([['a\u007f.txt', 0], ['é.txt', 0x0800]]);
  });

  test('a relative path that starts with a slash has an empty folder and keeps the rest as the entry name', async () => {
    const zipped = await zipFolderFiles({ files: [picked('/a.txt', 'x')], maxBytes: 1_000 });
    expect(zipped.name).toBe('folder.zip');
    expect(entries(new Uint8Array(await zipped.arrayBuffer()))).toEqual([['a.txt', 0]]);
  });
});

describe('zipLocalFolder', () => {
  async function folder(files: Record<string, string>) {
    const root = await mkdtemp(path.join(tmpdir(), 'jini-zip-local-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
    }
    return root;
  }

  test('a zip of exactly maxBytes is returned; one byte less is refused as too-large', async () => {
    const root = await folder({ 'a.txt': 'abc', 'b.txt': 'de' });
    // (30+5+3+46+5) + (30+5+2+46+5) + 22 = 199 bytes.
    expect((await zipLocalFolder({ path: root, maxBytes: 199 })).length).toBe(199);
    await expect(zipLocalFolder({ path: root, maxBytes: 198 })).rejects.toMatchObject({ reason: 'too-large' });
    await expect(zipLocalFolder({ path: root, maxBytes: 4 })).rejects.toMatchObject({ reason: 'too-large' });
  });

  test('entries are sorted by relative path, files and folders interleaved ("a.txt" before "a/x.txt")', async () => {
    const root = await folder({ 'b.txt': '1', 'a.txt': '2', 'c/y.txt': '3', 'a/x.txt': '4', 'a/b/z.txt': '5' });
    expect(entries(await zipLocalFolder({ path: root, maxBytes: 10_000 })).map(([name]) => name)).toEqual(['a.txt', 'a/b/z.txt', 'a/x.txt', 'b.txt', 'c/y.txt']);
  });

  test(`exactly ${FOLDER_MAX_FILES} entries are read; one more is refused as too-many`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jini-zip-many-'));
    roots.push(root);
    await Promise.all(Array.from({ length: FOLDER_MAX_FILES }, (_, i) => writeFile(path.join(root, `f${i}.txt`), '')));
    await expect(zipLocalFolder({ path: root, maxBytes: 10_000_000 })).resolves.toBeInstanceOf(Uint8Array);
    await writeFile(path.join(root, 'one-more.txt'), '');
    const refused = await zipLocalFolder({ path: root, maxBytes: 10_000_000 }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(FolderZipError);
    expect(refused).toMatchObject({ reason: 'too-many' });
  }, 60_000);
});

describe('isMcpManifest', () => {
  test.each<[unknown, boolean]>([
    [{ mcpServers: {} }, true], [{ mcpServers: null }, false], [{ mcpServers: [] }, false], [{ mcpServers: 'x' }, false],
    [{}, false], [null, false], ['x', false], [42, false], [undefined, false],
  ])('%j -> %s', (value, expected) => {
    expect(isMcpManifest(value)).toBe(expected);
  });
});
