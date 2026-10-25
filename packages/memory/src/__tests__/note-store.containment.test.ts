/**
 * Path-containment negatives for the note store (Stryker L5, 2026-10-25: the `isValidId` anchors /
 * 96-char limit, the `invalid note id` throw, the separator/NUL subdir guard, the realpath
 * containment decision and the read-paths-never-create flags all survived mutation). Real temp
 * directories, no mocked filesystem: each test would let a file outside the store be read, deleted
 * or created if its guard were removed.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNoteStore, NoteStoreConfigError } from '../note-store.js';

const config = { validTypes: ['user', 'project'], defaultType: 'user' };
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function dataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'note-contain-'));
  roots.push(d);
  return d;
}

const entryFile = (name: string) => `---\nname: ${name}\ndescription: d\ntype: user\n---\nSECRET ${name}\n`;

describe('note ids are refused at the file-path boundary', () => {
  it.each([
    ['parent traversal', '../secret'],
    ['nested path', 'a/b'],
    ['uppercase', 'Secret'],
    ['hyphen', 'a-b'],
    ['trailing newline', 'secret\n'],
    ['leading dot', '.secret'],
    ['97 chars', 'a'.repeat(97)],
  ])('readEntry and deleteEntry ignore an invalid id (%s)', async (_label, id) => {
    const d = dataDir();
    const store = createNoteStore(config);
    mkdirSync(join(d, 'notes'));
    // A file the invalid id would reach if it were joined unchecked.
    writeFileSync(join(d, 'secret.md'), entryFile('outside'));
    writeFileSync(join(d, 'notes', 'a'.repeat(97) + '.md'), entryFile('long'));
    expect(await store.readEntry({ dataDir: d, id })).toBeNull();
    await store.deleteEntry({ dataDir: d, id });
    expect(readFileSync(join(d, 'secret.md'), 'utf8')).toContain('SECRET outside');
    expect(existsSync(join(d, 'notes', 'a'.repeat(97) + '.md'))).toBe(true);
  });

  it('accepts an id of exactly 96 chars, and lists only valid ids', async () => {
    const d = dataDir();
    const store = createNoteStore(config);
    const id = 'a'.repeat(96);
    await store.upsertEntry({ dataDir: d, input: { id, name: 'n', type: 'user', body: 'b' } });
    expect((await store.readEntry({ dataDir: d, id }))?.id).toBe(id);
    writeFileSync(join(d, 'notes', 'Bad.md'), entryFile('bad'));
    writeFileSync(join(d, 'notes', 'b'.repeat(97) + '.md'), entryFile('long'));
    writeFileSync(join(d, 'notes', 'ok.txt'), entryFile('txt'));
    writeFileSync(join(d, 'notes', 'ok.md.bak'), entryFile('bak'));
    writeFileSync(join(d, 'notes', 'a-b.md'), entryFile('hyphen'));
    expect(await store.readEntry({ dataDir: d, id: 'a-b' })).toBeNull();
    expect((await store.listEntries({ dataDir: d })).map((e) => e.id)).toEqual([id]);
  });

  it('an invalid caller id on upsert falls back to the derived id instead of being used as a path', async () => {
    const d = dataDir();
    const store = createNoteStore(config);
    const entry = await store.upsertEntry({ dataDir: d, input: { id: '../escape', name: 'Hello World', type: 'user' } });
    expect(entry.id).toBe(store.deriveId({ type: 'user', name: 'Hello World' }));
    expect(existsSync(join(d, 'escape.md'))).toBe(false);
  });
});

describe('subdir option', () => {
  it.each([
    ['a/b', 'must not contain path separators'],
    ['a\\b', 'must not contain path separators'],
    ['a\0b', 'must not contain path separators'],
    ['C:foo', 'must be a single path segment'],
    ['..', 'not "." or ".."'],
    ['', 'non-empty string of at most 128 characters'],
    ['x'.repeat(129), 'non-empty string of at most 128 characters'],
  ])('refuses %j with the specific reason', (subdir, reason) => {
    expect(() => createNoteStore(config, { subdir })).toThrow(reason);
  });

  it('accepts a 128-char single segment', () => {
    expect(() => createNoteStore(config, { subdir: 'x'.repeat(128) })).not.toThrow();
  });
});

describe('realpath containment', () => {
  it('a notes dir symlinked outside the data root is refused for writes and reads', async () => {
    const d = dataDir();
    const outside = dataDir();
    writeFileSync(join(outside, 'leak.md'), entryFile('leak'));
    symlinkSync(outside, join(d, 'notes'));
    const store = createNoteStore(config);
    await expect(store.upsertEntry({ dataDir: d, input: { id: 'x', name: 'x', type: 'user' } })).rejects.toThrow(/escapes its data root/);
    expect(existsSync(join(outside, 'x.md'))).toBe(false);
    expect(await store.listEntries({ dataDir: d })).toEqual([]);
    expect(await store.readEntry({ dataDir: d, id: 'leak' })).toBeNull();
    const err = await store.readConfig({ dataDir: d }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoteStoreConfigError);
    expect((err as Error).message).toMatch(/escapes its data root/);
  });

  it('a symlink that stays inside the data root is allowed', async () => {
    const d = dataDir();
    mkdirSync(join(d, 'real'));
    symlinkSync(join(d, 'real'), join(d, 'notes'));
    const store = createNoteStore(config);
    await store.upsertEntry({ dataDir: d, input: { id: 'x', name: 'x', type: 'user' } });
    expect(existsSync(join(d, 'real', 'x.md'))).toBe(true);
  });

  it('a notes dir that resolves to the data root itself is contained (rel === "")', async () => {
    const d = dataDir();
    symlinkSync(d, join(d, 'notes'));
    const store = createNoteStore(config);
    await store.upsertEntry({ dataDir: d, input: { id: 'x', name: 'x', type: 'user' } });
    expect(existsSync(join(d, 'x.md'))).toBe(true);
  });

  it('readConfig: enabled unless the file says enabled:false', async () => {
    for (const [raw, enabled] of [['{"enabled":true}', true], ['{}', true], ['{"enabled":"no"}', true], ['{"enabled":false}', false], ['null', true]] as const) {
      const d = dataDir();
      mkdirSync(join(d, 'notes'));
      writeFileSync(join(d, 'notes', '.config.json'), raw);
      expect(await createNoteStore(config).readConfig({ dataDir: d })).toEqual({ enabled });
    }
  });

  it('a symlinked entry file is never read through', async () => {
    const d = dataDir();
    const outside = dataDir();
    writeFileSync(join(outside, 'target.md'), entryFile('target'));
    mkdirSync(join(d, 'notes'));
    symlinkSync(join(outside, 'target.md'), join(d, 'notes', 'link.md'));
    const store = createNoteStore(config);
    expect(await store.readEntry({ dataDir: d, id: 'link' })).toBeNull();
    expect(await store.listEntries({ dataDir: d })).toEqual([]);
  });
});

describe('read paths never create directories', () => {
  it('readEntry, listEntries, readIndex, readConfig and listActiveEntries leave an empty data dir empty', async () => {
    const d = dataDir();
    const store = createNoteStore(config);
    expect(await store.readEntry({ dataDir: d, id: 'x' })).toBeNull();
    expect(await store.listEntries({ dataDir: d })).toEqual([]);
    expect(await store.readIndex({ dataDir: d })).toContain('# Notes');
    expect(await store.readConfig({ dataDir: d })).toEqual({ enabled: true });
    expect(await store.listActiveEntries({ dataDir: d })).toEqual([]);
    expect(existsSync(join(d, 'notes'))).toBe(false);
  });

  it('writes do create the directory chain', async () => {
    const d = dataDir();
    const store = createNoteStore(config);
    await store.writeConfig({ dataDir: d, patch: { enabled: false } });
    expect(JSON.parse(readFileSync(join(d, 'notes', '.config.json'), 'utf8'))).toEqual({ enabled: false });
  });
});
