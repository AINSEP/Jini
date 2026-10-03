import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNoteStore, NoteStoreConfigError, type NoteChangeEvent, type NoteStore } from '../note-store.js';

const config = { validTypes: ['user', 'feedback', 'project'], defaultType: 'user' };

let dataDir: string;
let store: NoteStore;
let changes: NoteChangeEvent[];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'jini-note-store-'));
  store = createNoteStore(config);
  changes = [];
  store.events.on('change', (e: NoteChangeEvent) => changes.push(e));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('NoteStoreConfigError', () => {
  it('sets code/name/message and threads a cause through to the real Error options', () => {
    const cause = new Error('underlying failure');
    const error = new NoteStoreConfigError({ message: 'bad config', code: 'EBAD' }, { cause: cause });
    expect(error.name).toBe('NoteStoreConfigError');
    expect(error.code).toBe('EBAD');
    expect(error.message).toBe('bad config');
    expect(error.cause).toBe(cause);
  });

  it('constructs cleanly with no cause at all (an optional public-API parameter — no real call site in this package omits it, but external consumers may)', () => {
    const error = new NoteStoreConfigError({ message: 'bad config', code: 'EBAD' });
    expect(error.name).toBe('NoteStoreConfigError');
    expect(error.code).toBe('EBAD');
    expect(error.cause).toBeUndefined();
  });
});

describe('createNoteStore', () => {
  it('dir() joins the configured subdir under dataDir, defaulting to "notes"', () => {
    expect(store.dir({ dataDir: dataDir })).toBe(join(dataDir, 'notes'));
    const customStore = createNoteStore(config, { subdir: 'memory' });
    expect(customStore.dir({ dataDir: dataDir })).toBe(join(dataDir, 'memory'));
  });

  describe('deriveId', () => {
    it('slugifies the name under the type prefix', () => {
      expect(store.deriveId({ type: 'user', name: 'My Role!' })).toBe('user_my_role');
    });

    it('treats a falsy name as an empty string before slugifying', () => {
      expect(store.deriveId({ type: 'user', name: undefined as unknown as string })).toMatch(/^user_n[0-9a-z]+$/);
    });

    it('falls back to defaultType for an invalid type', () => {
      expect(store.deriveId({ type: 'not-a-type', name: 'X' })).toBe('user_x');
    });

    it('hashes a purely non-ASCII name deterministically instead of an empty slug', () => {
      const id = store.deriveId({ type: 'user', name: '设计思路' });
      expect(id).toMatch(/^user_n[0-9a-z]+$/);
      expect(store.deriveId({ type: 'user', name: '设计思路' })).toBe(id);
    });

    it('produces different hash ids for different non-ASCII names', () => {
      expect(store.deriveId({ type: 'user', name: '设计思路' })).not.toBe(store.deriveId({ type: 'user', name: '视觉风格' }));
    });
  });

  describe('config', () => {
    it('defaults to enabled when no config file exists', async () => {
      await expect(store.readConfig({ dataDir: dataDir })).resolves.toEqual({ enabled: true });
    });

    it('writes and reads back a config patch, emitting a config change only when it actually flips', async () => {
      await store.writeConfig({ dataDir: dataDir, patch: { enabled: false } });
      await expect(store.readConfig({ dataDir: dataDir })).resolves.toEqual({ enabled: false });
      expect(changes.filter((c) => c.kind === 'config')).toHaveLength(1);

      changes.length = 0;
      await store.writeConfig({ dataDir: dataDir, patch: { enabled: false } });
      expect(changes.filter((c) => c.kind === 'config')).toHaveLength(0);
    });

    it('leaves enabled unchanged when the patch omits it', async () => {
      await store.writeConfig({ dataDir: dataDir, patch: { enabled: false } });
      await store.writeConfig({ dataDir: dataDir, patch: {} });
      await expect(store.readConfig({ dataDir: dataDir })).resolves.toEqual({ enabled: false });
    });
  });

  describe('index', () => {
    it('returns the default index text when none has been written', async () => {
      const index = await store.readIndex({ dataDir: dataDir });
      expect(index).toContain('# Notes');
    });

    it('writes the index and emits an index change unless silent', async () => {
      await store.writeIndex({ dataDir: dataDir, body: 'custom index body' });
      await expect(store.readIndex({ dataDir: dataDir })).resolves.toBe('custom index body');
      expect(changes.filter((c) => c.kind === 'index')).toHaveLength(1);

      changes.length = 0;
      await store.writeIndex({ dataDir: dataDir, body: 'again' }, { silent: true });
      expect(changes).toHaveLength(0);
    });
  });

  describe('entries', () => {
    it('upserts a new entry, deriving an id, and lists it', async () => {
      const entry = await store.upsertEntry({ dataDir: dataDir, input: { name: 'Role', description: 'desc', type: 'user', body: '- Role: engineer' } });
      expect(entry.id).toBe('user_role');
      expect(entry.body.trim()).toBe('- Role: engineer');

      const list = await store.listEntries({ dataDir: dataDir });
      expect(list.map((e) => e.id)).toEqual(['user_role']);
      expect(changes.filter((c) => c.kind === 'upsert')).toHaveLength(1);
    });

    it('rejects an upsert missing a name or a valid type', async () => {
      await expect(store.upsertEntry({ dataDir: dataDir, input: { name: '', type: 'user' } })).rejects.toThrow(/requires .name. and a valid .type./);
      await expect(store.upsertEntry({ dataDir: dataDir, input: { name: 'X', type: 'bogus' } })).rejects.toThrow(/requires .name. and a valid .type./);
    });

    it('suppresses the change event when silent, and tags a custom source when provided', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } }, { silent: true });
      expect(changes.filter((c) => c.kind === 'upsert')).toHaveLength(0);

      await store.upsertEntry({ dataDir: dataDir, input: { name: 'B', type: 'user' } }, { source: 'heuristic' });
      expect(changes.find((c) => c.kind === 'upsert')?.source).toBe('heuristic');
    });

    it('honors an explicit valid id instead of deriving one', async () => {
      const entry = await store.upsertEntry({ dataDir: dataDir, input: { id: 'user_custom', name: 'Custom', type: 'user' } });
      expect(entry.id).toBe('user_custom');
    });

    it('falls back to a derived id when the supplied id is not a valid slug', async () => {
      const entry = await store.upsertEntry({ dataDir: dataDir, input: { id: 'Not Valid!', name: 'Fallback', type: 'user' } });
      expect(entry.id).toBe('user_fallback');
    });

    it('readEntry returns null for a missing entry', async () => {
      await expect(store.readEntry({ dataDir: dataDir, id: 'user_missing' })).resolves.toBeNull();
    });

    it('readEntry returns null for a syntactically invalid id rather than throwing', async () => {
      await expect(store.readEntry({ dataDir: dataDir, id: 'Not A Valid Id!' })).resolves.toBeNull();
    });

    it('falls back to the id itself as the display name when the frontmatter name is blank', async () => {
      const fs = await import('node:fs/promises');
      const { mkdir, writeFile } = fs;
      await mkdir(store.dir({ dataDir: dataDir }), { recursive: true });
      await writeFile(join(store.dir({ dataDir: dataDir }), 'user_blank.md'), '---\nname: \ndescription: \ntype: user\n---\n\nbody\n');
      const entry = await store.readEntry({ dataDir: dataDir, id: 'user_blank' });
      expect(entry?.name).toBe('user_blank');
    });

    it('surfaces the "failed to read after write" invariant if the entry file vanishes between write and read', async () => {
      const fs = await import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalReadFile: any = fs.promises.readFile;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (filePath: any, ...rest: any[]) => {
        if (typeof filePath === 'string' && filePath.endsWith('user_vanish.md')) {
          const err = new Error('ENOENT: simulated concurrent delete') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return originalReadFile(filePath, ...rest);
      });
      try {
        await expect(store.upsertEntry({ dataDir: dataDir, input: { id: 'user_vanish', name: 'Vanish', type: 'user' } })).rejects.toThrow(
          /failed to read note entry after write/,
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('defaults a stored type to defaultType when the frontmatter type is invalid or missing', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      // Directly corrupt the file's type field to something invalid.
      const fs = await import('node:fs/promises');
      const filePath = join(store.dir({ dataDir: dataDir }), 'user_a.md');
      const raw = await fs.readFile(filePath, 'utf8');
      await fs.writeFile(filePath, raw.replace('type: user', 'type: not-a-type'));
      const entry = await store.readEntry({ dataDir: dataDir, id: 'user_a' });
      expect(entry?.type).toBe('user');
    });

    it('deletes an entry and removes its index line, tolerating a missing file', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      await store.deleteEntry({ dataDir: dataDir, id: 'user_a' });
      await expect(store.readEntry({ dataDir: dataDir, id: 'user_a' })).resolves.toBeNull();
      expect((await store.readIndex({ dataDir: dataDir })).includes('user_a.md')).toBe(false);
      expect(changes.filter((c) => c.kind === 'delete')).toHaveLength(1);

      // Deleting again (file already gone) must not throw.
      await expect(store.deleteEntry({ dataDir: dataDir, id: 'user_a' })).resolves.toBeUndefined();
    });

    it('listEntries returns [] when the store directory does not exist yet', async () => {
      await expect(store.listEntries({ dataDir: dataDir })).resolves.toEqual([]);
    });

    it('listEntries ignores the index file, non-.md files, and an invalid-id filename', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const fs = await import('node:fs/promises');
      await fs.writeFile(join(store.dir({ dataDir: dataDir }), 'not-an-entry.txt'), 'x');
      await fs.writeFile(join(store.dir({ dataDir: dataDir }), 'INVALID ID.md'), 'x');
      const list = await store.listEntries({ dataDir: dataDir });
      expect(list.map((e) => e.id)).toEqual(['user_a']);
    });

    it('listEntries skips a validly-named entry file that fails to read (e.g. a directory in its place)', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const fs = await import('node:fs/promises');
      // A directory named like an entry file: passes the .md/id checks but
      // fsp.readFile on it throws EISDIR, exercising the catch-and-skip path.
      await fs.mkdir(join(store.dir({ dataDir: dataDir }), 'user_broken.md'));
      const list = await store.listEntries({ dataDir: dataDir });
      expect(list.map((e) => e.id)).toEqual(['user_a']);
    });

    it('listEntries sorts newest-updated first', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'First', type: 'user' } });
      await new Promise((r) => setTimeout(r, 5));
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'Second', type: 'user' } });
      const list = await store.listEntries({ dataDir: dataDir });
      expect(list.map((e) => e.id)).toEqual(['user_second', 'user_first']);
    });
  });

  describe('listActiveEntries', () => {
    it('returns only entries linked in the index, excluding ones the user removed the bullet for', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'Kept', type: 'user' } });
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'Removed', type: 'user' } });
      const index = await store.readIndex({ dataDir: dataDir });
      await store.writeIndex({ dataDir: dataDir, body: index.replace(/^- \[Removed\].*$/m, '') }, { silent: true });

      const active = await store.listActiveEntries({ dataDir: dataDir });
      expect(active.map((e) => e.id)).toEqual(['user_kept']);
    });

    it('returns an empty list when the index links nothing', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      await store.writeIndex({ dataDir: dataDir, body: '# Notes\n\nno links here\n' }, { silent: true });
      await expect(store.listActiveEntries({ dataDir: dataDir })).resolves.toEqual([]);
    });

    it('ignores a bulleted link that does not point at a .md file, and one pointing at the index itself', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const index = await store.readIndex({ dataDir: dataDir });
      await store.writeIndex({ dataDir: dataDir, body: `${index}\n- [Not markdown](readme.txt)\n- [Self](INDEX.md)\n` }, { silent: true });
      const active = await store.listActiveEntries({ dataDir: dataDir });
      expect(active.map((e) => e.id)).toEqual(['user_a']);
    });
  });

  describe('index maintenance', () => {
    it('links a new entry with its description, and re-links (replaces) on a repeat upsert', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', description: 'first desc', type: 'user' } });
      let index = await store.readIndex({ dataDir: dataDir });
      expect(index).toContain('- [A](user_a.md) — first desc');

      await store.upsertEntry({ dataDir: dataDir, input: { id: 'user_a', name: 'A', description: 'updated desc', type: 'user' } });
      index = await store.readIndex({ dataDir: dataDir });
      expect(index).toContain('- [A](user_a.md) — updated desc');
      expect(index.match(/user_a\.md/g)).toHaveLength(1);
    });

    it('links an entry with no description without an em-dash suffix', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'NoDesc', type: 'user' } });
      const index = await store.readIndex({ dataDir: dataDir });
      expect(index).toContain('- [NoDesc](user_nodesc.md)');
      expect(index).not.toContain('- [NoDesc](user_nodesc.md) —');
    });

    it('appends a blank separator line before a new bullet when the index does not already end with one', async () => {
      await store.writeIndex({ dataDir: dataDir, body: 'existing prose, no trailing blank line' });
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const index = await store.readIndex({ dataDir: dataDir });
      expect(index).toBe('existing prose, no trailing blank line\n\n- [A](user_a.md)');
    });
  });

  describe('updateTreeNode', () => {
    it('refuses to edit a folder node', async () => {
      await expect(store.updateTreeNode({ dataDir: dataDir, id: 'folder:user', patch: {} })).rejects.toThrow(/derived and cannot be edited/);
    });

    it('throws when the target entry does not exist', async () => {
      await expect(store.updateTreeNode({ dataDir: dataDir, id: 'user_missing', patch: {} })).rejects.toThrow(/not found/);
    });

    it('patches only the given fields, keeping the rest from the current entry', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', description: 'd', type: 'user', body: 'body' } });
      const updated = await store.updateTreeNode({ dataDir: dataDir, id: 'user_a', patch: { description: 'new-d' } });
      expect(updated).toMatchObject({ name: 'A', description: 'new-d', type: 'user' });
      expect(updated.body.trim()).toBe('body');
    });

    it('falls back to the current name when the patch supplies a blank name, and to the current type when the patch type is invalid', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const updated = await store.updateTreeNode({ dataDir: dataDir, id: 'user_a', patch: { name: '   ', type: 'bogus' } });
      expect(updated.name).toBe('A');
      expect(updated.type).toBe('user');
    });

    it('accepts a valid type change', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const updated = await store.updateTreeNode({ dataDir: dataDir, id: 'user_a', patch: { type: 'feedback' } });
      expect(updated.type).toBe('feedback');
    });

    it('accepts a genuine non-blank name change', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const updated = await store.updateTreeNode({ dataDir: dataDir, id: 'user_a', patch: { name: 'Renamed' } });
      expect(updated.name).toBe('Renamed');
    });
  });

  describe('buildTree', () => {
    it('capitalize()s an empty-string type name to itself rather than throwing', async () => {
      const oddStore = createNoteStore({ validTypes: ['', 'user'], defaultType: 'user' });
      const tree = await oddStore.buildTree({ dataDir: dataDir });
      const blankFolder = tree.find((n) => n.id === 'folder:');
      expect(blankFolder).toMatchObject({ name: '', description: ' notes' });
    });

    it('groups an entry whose normalized type falls outside the configured folder list under an ungrouped bucket', async () => {
      // defaultType deliberately NOT a member of validTypes: an entry with a
      // corrupted/unrecognized type normalizes to defaultType, which is
      // outside the pre-seeded per-type buckets buildTree groups folders by.
      const oddStore = createNoteStore({ validTypes: ['user'], defaultType: 'unrouted' });
      await oddStore.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      const fs = await import('node:fs/promises');
      const filePath = join(oddStore.dir({ dataDir: dataDir }), 'user_a.md');
      const raw = await fs.readFile(filePath, 'utf8');
      await fs.writeFile(filePath, raw.replace('type: user', 'type: not-a-real-type'));

      const tree = await oddStore.buildTree({ dataDir: dataDir });
      // Only one folder ('user') is declared; the ungrouped entry does not
      // appear as a folder child anywhere, but buildTree still completes
      // without throwing (the fallback in the entries-grouping loop).
      expect(tree.filter((n) => n.kind === 'folder')).toHaveLength(1);
      expect(tree.some((n) => n.id === 'user_a')).toBe(false);
    });

    it('produces one folder node per configured type plus one entry node per stored entry', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', description: 'a-desc', type: 'user' } });
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'B', type: 'feedback' } });
      const tree = await store.buildTree({ dataDir: dataDir });

      const folders = tree.filter((n) => n.kind === 'folder');
      expect(folders.map((f) => f.id)).toEqual(['folder:user', 'folder:feedback', 'folder:project']);
      expect(folders.find((f) => f.id === 'folder:user')?.childrenCount).toBe(1);
      expect(folders.find((f) => f.id === 'folder:project')?.childrenCount).toBe(0);

      const entryNode = tree.find((n) => n.id === 'user_a');
      expect(entryNode).toMatchObject({ parentId: 'folder:user', path: '/user/user_a', name: 'A', description: 'a-desc', kind: 'entry' });
    });
  });
});

// CR-010 / SEC-RB-004: filesystem-escape and fail-open hardening.
describe('createNoteStore — filesystem safety hardening', () => {
  describe('subdir validation', () => {
    it('rejects a subdir containing ".." at construction time', () => {
      expect(() => createNoteStore(config, { subdir: '../../etc' })).toThrow(/subdir/);
      expect(() => createNoteStore(config, { subdir: '..' })).toThrow(/subdir/);
    });

    it('rejects a subdir containing a path separator', () => {
      expect(() => createNoteStore(config, { subdir: 'a/b' })).toThrow(/subdir/);
      expect(() => createNoteStore(config, { subdir: 'a\\b' })).toThrow(/subdir/);
    });

    it('rejects an absolute subdir', () => {
      expect(() => createNoteStore(config, { subdir: '/etc' })).toThrow(/subdir/);
    });

    it('accepts a plain single-segment subdir', () => {
      expect(() => createNoteStore(config, { subdir: 'my-notes' })).not.toThrow();
    });

    it('rejects an empty subdir', () => {
      expect(() => createNoteStore(config, { subdir: '' })).toThrow(/non-empty/);
    });

    it('rejects a subdir longer than 128 characters', () => {
      expect(() => createNoteStore(config, { subdir: 'x'.repeat(129) })).toThrow(/128/);
    });

    it('rejects a non-string subdir at runtime, for JS callers bypassing the type system', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => createNoteStore(config, { subdir: 42 as any })).toThrow(/non-empty/);
    });

    // `assertSafeSubdir`'s final guard was refactored (2026-07-22, audit fix) from the
    // platform-bound `path.basename`/`path.isAbsolute` to `path.win32.basename`/
    // `path.win32.isAbsolute` explicitly — the platform-bound version was only reachable on an
    // actual Windows host (`path.win32.basename('C:foo') === 'foo' !== 'C:foo'`, a real
    // drive-relative-path ambiguity no `/`/`\`/`.`/`..` check above it catches), so on this
    // (POSIX) CI host the branch was genuinely dead code, not a padded/skipped test. Using
    // `path.win32` unconditionally makes the check's outcome identical on every host OS — and
    // means the branch is now directly testable here without mocking `node:path` at all.
    it('rejects a Windows drive-relative subdir like "C:foo" — no slash present, so only path.win32-aware parsing catches it', () => {
      expect(() => createNoteStore(config, { subdir: 'C:foo' })).toThrow(/single path segment/);
    });
  });

  describe('symlink containment', () => {
    it('rejects operations when the configured subdir is a symlink that escapes dataDir, and does not write through it', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'jini-note-store-outside-'));
      try {
        const fs = await import('node:fs/promises');
        // Plant a symlink named "notes" inside dataDir pointing entirely outside it.
        await fs.symlink(outsideDir, join(dataDir, 'notes'), 'dir');

        await expect(store.upsertEntry({ dataDir: dataDir, input: { name: 'Evil', type: 'user' } })).rejects.toThrow(/escapes its data root/);
        await expect(store.readConfig({ dataDir: dataDir })).rejects.toThrow();
        await expect(store.listEntries({ dataDir: dataDir })).resolves.toEqual([]);

        // Nothing should have been written into the outside directory.
        const outsideContents = await fs.readdir(outsideDir);
        expect(outsideContents).toEqual([]);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects reading through a symlinked entry file that points outside the store, instead of following it', async () => {
      const fs = await import('node:fs/promises');
      const secretDir = mkdtempSync(join(tmpdir(), 'jini-note-store-secret-'));
      try {
        const secretPath = join(secretDir, 'secret.txt');
        await fs.writeFile(secretPath, 'super-secret-content');

        await store.upsertEntry({ dataDir: dataDir, input: { name: 'X', type: 'user' } });
        const entryPath = join(store.dir({ dataDir: dataDir }), 'user_x.md');
        await fs.unlink(entryPath);
        await fs.symlink(secretPath, entryPath);

        const entry = await store.readEntry({ dataDir: dataDir, id: 'user_x' });
        expect(entry).toBeNull();

        const list = await store.listEntries({ dataDir: dataDir });
        expect(list.map((e) => e.id)).not.toContain('user_x');
      } finally {
        rmSync(secretDir, { recursive: true, force: true });
      }
    });

    it('does not follow a symlinked entry file when deleting (unlink removes the link, not its target)', async () => {
      const fs = await import('node:fs/promises');
      const outsideDir = mkdtempSync(join(tmpdir(), 'jini-note-store-outside-del-'));
      try {
        const targetPath = join(outsideDir, 'target.txt');
        await fs.writeFile(targetPath, 'must-survive');

        await store.upsertEntry({ dataDir: dataDir, input: { name: 'Y', type: 'user' } });
        const entryPath = join(store.dir({ dataDir: dataDir }), 'user_y.md');
        await fs.unlink(entryPath);
        await fs.symlink(targetPath, entryPath);

        await store.deleteEntry({ dataDir: dataDir, id: 'user_y' });

        await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('must-survive');
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('index injection', () => {
    it('escapes embedded newlines and Markdown link syntax in name/description without corrupting the index structure', async () => {
      const maliciousName = 'Evil](../../etc/passwd) [Injected';
      const maliciousDesc = 'line1\nline2 [Click me](https://evil.example/steal)';
      await store.upsertEntry({ dataDir: dataDir, input: { name: maliciousName, description: maliciousDesc, type: 'user' } });

      const index = await store.readIndex({ dataDir: dataDir });
      const bulletLines = index.split(/\r?\n/).filter((l) => l.trim().startsWith('- ['));
      // Exactly one bullet was produced — no extra bullet/link was injected
      // via the embedded newline or bracket/paren syntax.
      expect(bulletLines).toHaveLength(1);

      // The raw stored text must not contain an unescaped "](" sequence
      // other than the legitimate one preceding the real (id-derived) href.
      const rawLinkOpenings = index.match(/(?<!\\)\]\(/g) ?? [];
      expect(rawLinkOpenings).toHaveLength(1);

      // The entry is still correctly recognized as linked/active despite
      // the special characters (round-trips through the parser).
      const active = await store.listActiveEntries({ dataDir: dataDir });
      expect(active.map((e) => e.id)).toContain('user_evil_etc_passwd_injected');
    });

    it('keeps a single physical index line for a name that is only newlines', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: '\n\n\n', type: 'user' } });
      const index = await store.readIndex({ dataDir: dataDir });
      const bulletLines = index.split(/\r?\n/).filter((l) => l.trim().startsWith('- ['));
      expect(bulletLines).toHaveLength(1);
    });
  });

  describe('listener isolation', () => {
    it('does not reject the write call when a change listener throws', async () => {
      store.events.on('change', () => {
        throw new Error('listener boom');
      });
      await expect(store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } })).resolves.toMatchObject({ id: 'user_a' });
      // The write actually committed despite the throwing listener.
      const entry = await store.readEntry({ dataDir: dataDir, id: 'user_a' });
      expect(entry).not.toBeNull();
    });

    it('does not reject deleteEntry or writeConfig/writeIndex when a listener throws', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      store.events.on('change', () => {
        throw new Error('listener boom');
      });
      await expect(store.deleteEntry({ dataDir: dataDir, id: 'user_a' })).resolves.toBeUndefined();
      await expect(store.writeConfig({ dataDir: dataDir, patch: { enabled: false } })).resolves.toEqual({ enabled: false });
      await expect(store.writeIndex({ dataDir: dataDir, body: 'x' })).resolves.toBeUndefined();
    });
  });

  describe('config fail-closed semantics', () => {
    it('fails closed (rejects) rather than defaulting to enabled when the config file is unreadable for a reason other than "missing"', async () => {
      await store.writeConfig({ dataDir: dataDir, patch: { enabled: false } });

      const fs = await import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLstat: any = fs.promises.lstat;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (p: any, ...rest: any[]) => {
        // Match by suffix, not exact equality: the store resolves the
        // realpath of its directory before joining the filename, which can
        // differ lexically from a directly-constructed path (e.g. /tmp vs.
        // /private/tmp on macOS).
        if (typeof p === 'string' && p.endsWith('.config.json')) {
          const err = new Error('EACCES: permission denied, lstat') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        }
        return originalLstat(p, ...rest);
      });
      try {
        const err = await store.readConfig({ dataDir: dataDir }).catch((e) => e);
        expect(err).toBeInstanceOf(NoteStoreConfigError);
        expect(err).toMatchObject({ code: 'EACCES' });
      } finally {
        spy.mockRestore();
      }
    });

    it('still defaults to enabled when the config file is genuinely missing (ENOENT)', async () => {
      await expect(store.readConfig({ dataDir: dataDir })).resolves.toEqual({ enabled: true });
    });

    it('fails closed on corrupt JSON rather than treating it as enabled', async () => {
      const fs = await import('node:fs/promises');
      await fs.mkdir(store.dir({ dataDir: dataDir }), { recursive: true });
      await fs.writeFile(join(store.dir({ dataDir: dataDir }), '.config.json'), '{ not valid json');
      await expect(store.readConfig({ dataDir: dataDir })).rejects.toBeInstanceOf(NoteStoreConfigError);
      await expect(store.readConfig({ dataDir: dataDir })).rejects.toMatchObject({ code: 'EPARSE' });
    });

    it('fails closed with ENOTREG rather than reading through when the config path is a directory, not a file', async () => {
      const fs = await import('node:fs/promises');
      // A directory at the expected config path exercises readRegularFileStrict's
      // `!st.isFile()` guard — lstat succeeds (so this isn't the ENOENT path)
      // but the entry itself must be rejected rather than followed/read.
      await fs.mkdir(join(store.dir({ dataDir: dataDir }), '.config.json'), { recursive: true });
      const err = await store.readConfig({ dataDir: dataDir }).catch((e) => e);
      expect(err).toBeInstanceOf(NoteStoreConfigError);
      expect(err).toMatchObject({ code: 'ENOTREG' });
    });
  });

  describe('atomic writes', () => {
    it('leaves no stray temp files behind after entry/index/config writes', async () => {
      await store.upsertEntry({ dataDir: dataDir, input: { name: 'A', type: 'user' } });
      await store.writeConfig({ dataDir: dataDir, patch: { enabled: false } });
      await store.writeIndex({ dataDir: dataDir, body: 'custom' });
      const fs = await import('node:fs/promises');
      const names = await fs.readdir(store.dir({ dataDir: dataDir }));
      expect(names.every((n) => !n.endsWith('.tmp'))).toBe(true);
    });

    it('replaces a pre-existing symlinked entry path atomically instead of writing through it', async () => {
      const fs = await import('node:fs/promises');
      const outsideDir = mkdtempSync(join(tmpdir(), 'jini-note-store-outside-write-'));
      try {
        const targetPath = join(outsideDir, 'target.txt');
        await fs.writeFile(targetPath, 'must-not-be-overwritten');
        await fs.mkdir(store.dir({ dataDir: dataDir }), { recursive: true });
        await fs.symlink(targetPath, join(store.dir({ dataDir: dataDir }), 'user_z.md'));

        const entry = await store.upsertEntry({ dataDir: dataDir, input: { id: 'user_z', name: 'Z', type: 'user' } });
        expect(entry.id).toBe('user_z');

        // The outside file must be untouched — rename() replaced the
        // symlink itself rather than writing through it.
        await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('must-not-be-overwritten');
        // And the store's own file must now be a plain, correctly-written entry.
        const stat = await fs.lstat(join(store.dir({ dataDir: dataDir }), 'user_z.md'));
        expect(stat.isSymbolicLink()).toBe(false);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('cleans up the temp file and propagates the original error when the final rename fails', async () => {
      const fs = await import('node:fs');
      const originalRename = fs.promises.rename;
      const spy = vi
        .spyOn(fs.promises, 'rename')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation(async (from: any, to: any) => {
          if (typeof from === 'string' && from.includes('.tmp')) {
            throw new Error('ENOSPC: no space left on device, rename');
          }
          return originalRename(from, to);
        });
      try {
        await expect(store.writeConfig({ dataDir: dataDir, patch: { enabled: false } })).rejects.toThrow(/ENOSPC/);
        const names = await fs.promises.readdir(store.dir({ dataDir: dataDir }));
        expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
