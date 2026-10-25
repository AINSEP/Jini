/**
 * @file Each guard of `skill-file-reader.ts` alone, pinned by the refusal message it alone produces:
 * every path rule (empty, NUL, backslash, absolute, drive prefix, `..` segment), every control byte
 * class (0x01-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f refused; tab/LF/CR and printable/UTF-8 admitted),
 * the BOM kept as text, the inventory's final sort, the walk depth limit at 32/33, and a read error
 * after open becoming the generic refusal. Closes Stryker run-2 survivors at skill-file-reader.ts:
 * 36, 37, 66, 102, 111, 126. Real temp folders; one fake filesystem port for the read error.
 */
import { afterEach, describe, expect, test } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSkillFileReader } from '../../index.js';
import type { FilesystemPort } from '../../ports.js';

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dir) => filesystem.rm(dir, { recursive: true, force: true }))); });
async function skill(files: Record<string, string | Buffer> = {}) {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), 'jini-skill-guards-'));
  cleanup.push(root);
  await filesystem.writeFile(path.join(root, 'SKILL.md'), '# Skill\n');
  for (const [name, content] of Object.entries(files)) {
    await filesystem.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await filesystem.writeFile(path.join(root, name), content);
  }
  return root;
}
const PATH_REFUSAL = 'File request refused: use a path relative to this skill folder, without traversal or absolute paths.';
const BINARY_REFUSAL = 'File request refused: binary content cannot be read as text.';

describe('path rules, each alone', () => {
  test.each(['a\0.md', 'refs\\a.md', '/abs.md', 'C:a.md', 'z:/a.md', '../a.md', 'refs/../a.md', 'refs/..'])('%j -> the path refusal', async (file) => {
    const reader = createSkillFileReader({ skillRoot: await skill({ 'a.md': 'A' }), filesystem });
    const result = await reader.read({}, { file });
    expect(result.text).toBe('');
    expect(result.note?.startsWith(PATH_REFUSAL)).toBe(true);
  });

  test('an empty file name is refused by the path rule, not read as SKILL.md', async () => {
    const reader = createSkillFileReader({ skillRoot: await skill(), filesystem });
    expect((await reader.read({}, { file: '' })).note?.startsWith(PATH_REFUSAL)).toBe(true);
  });

  test.each(['refs/C:a.md', 'a..b.md', '..a.md', 'refs/.../a.md'])('%j is a legal relative name and is read', async (file) => {
    const reader = createSkillFileReader({ skillRoot: await skill({ [file]: 'ok' }), filesystem });
    expect(await reader.read({}, { file })).toMatchObject({ text: 'ok' });
  });
});

describe('text admission by byte', () => {
  test.each([0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f])('control byte 0x%s among text is refused as binary', async (byte) => {
    const reader = createSkillFileReader({ skillRoot: await skill({ 'a.md': Buffer.from([0x41, byte, 0x42]) }), filesystem });
    expect((await reader.read({}, { file: 'a.md' })).note?.startsWith(BINARY_REFUSAL)).toBe(true);
  });

  test('tab, LF, CR, space, tilde and multi-byte UTF-8 are text', async () => {
    const text = 'a\tb\nc\rd ~ é 日本';
    const reader = createSkillFileReader({ skillRoot: await skill({ 'a.md': text }), filesystem });
    expect((await reader.read({}, { file: 'a.md' })).text).toBe(text);
  });

  test('a leading BOM is kept as part of the text', async () => {
    const reader = createSkillFileReader({ skillRoot: await skill({ 'a.md': Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]) }), filesystem });
    expect((await reader.read({}, { file: 'a.md' })).text).toBe('\uFEFFhi');
  });
});

describe('inventory', () => {
  test('is sorted as one flat list ("a.md" before "a/x.md"), not in walk order', async () => {
    const reader = createSkillFileReader({ skillRoot: await skill({ 'a/x.md': 'x', 'a.md': 'a', 'b.md': 'b' }), filesystem });
    expect((await reader.read({})).files).toEqual(['a.md', 'a/x.md', 'b.md']);
  });

  test('walks 32 directory levels deep; a 33rd level is reported incomplete', async () => {
    const deep = (levels: number) => `${Array.from({ length: levels }, () => 'd').join('/')}/f.md`;
    const ok = createSkillFileReader({ skillRoot: await skill({ [deep(32)]: 'f' }), filesystem });
    expect(await ok.read({})).toEqual({ text: '# Skill\n', files: [deep(32)] });
    const tooDeep = createSkillFileReader({ skillRoot: await skill({ [deep(33)]: 'f' }), filesystem });
    expect(await tooDeep.read({})).toEqual({ text: '# Skill\n', files: [], note: 'Supporting-file inventory is incomplete: traversal limit reached or a directory is unreadable.' });
  });
});

describe('read errors after open', () => {
  test('a handle whose read throws becomes the generic unreadable refusal, with no native error text', async () => {
    const root = await skill({ 'a.md': 'A' });
    const failing: FilesystemPort = {
      ...filesystem,
      open: (async (...args: Parameters<typeof filesystem.open>) => {
        const handle = await filesystem.open(...args);
        return Object.assign(Object.create(handle) as typeof handle, { read: async () => { throw new Error(`EIO at ${root}`); }, stat: () => handle.stat(), close: () => handle.close() });
      }) as typeof filesystem.open,
    };
    const result = await createSkillFileReader({ skillRoot: root, filesystem: failing }).read({}, { file: 'a.md' });
    expect(result.text).toBe('');
    expect(result.note?.startsWith('File request refused: file is missing or unreadable.')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
  });
});
