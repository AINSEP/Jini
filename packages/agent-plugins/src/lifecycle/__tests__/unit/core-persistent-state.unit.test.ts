import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_PLUGIN_MEMORY_LIMITS, assertPluginStatePath, createPluginMemory, migratePluginLayout, pluginStatePaths,
  withPluginStateLock, type PluginStateEffects,
} from '../../../../core/persistent-state.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file Direct contract tests for the build-free `core/persistent-state.js` implementation that both
 * the `./persistent-state` entry and `src/lifecycle/persistent-state.ts` share. Effects are the
 * module's own injected ports: a real `node:fs/promises` on a temp dir (wrapped per test to inject
 * failures a root-run sandbox cannot produce with chmod), a lexical `contain`, and a serial lock.
 */

type Filesystem = PluginStateEffects['filesystem'];
const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });

async function workspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-core-state-')));
  temporaries.push(dir);
  return dir;
}
function errno(code: string): Error { return Object.assign(new Error(`${code}: injected`), { code }); }
/** Lexical containment only, so symlink handling is decided by the unit under test itself. */
async function contain({ root, entryPath }: { root: string; entryPath: string }): Promise<string> {
  const resolved = path.resolve(root, entryPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`outside root: ${entryPath}`);
  return resolved;
}
const locks: string[] = [];
async function withLock<T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }): Promise<T> { locks.push(lockPath); return run(); }
function effects(filesystem: Filesystem = fs): PluginStateEffects { return { filesystem, contain, withLock }; }
async function put(root: string, relative: string, contents: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await fs.writeFile(path.join(root, relative), contents);
}
const manifest = (name: string) => JSON.stringify({ name });
const parsePluginId = ({ value }: { value: unknown }) => (value as { name: string }).name;

describe('pluginStatePaths', () => {
  test('lays out one plugin root with package, data, learned and notes children', () => {
    expect(pluginStatePaths({ workspaceRoot: '/ws', pluginId: 'acme.tool-1' })).toEqual({
      root: '/ws/acme.tool-1', packages: '/ws/acme.tool-1/package/sha256', data: '/ws/acme.tool-1/data',
      learned: '/ws/acme.tool-1/memory/learned', notes: '/ws/acme.tool-1/memory/notes',
    });
  });
  test.each([
    ['relative workspace root', 'ws', 'example'],
    ['unsafe id', '/ws', '../escape'],
    ['uppercase id', '/ws', 'Example'],
    ['over-long id', '/ws', 'a'.repeat(65)],
    ['reserved staging id', '/ws', 'staging'],
    ['reserved data id', '/ws', 'data'],
  ])('refuses a %s', (_label, workspaceRoot, pluginId) => {
    expect(() => pluginStatePaths({ workspaceRoot, pluginId })).toThrow('Invalid plugin state root or id');
  });
});

describe('assertPluginStatePath', () => {
  test('returns the contained path when a trailing ancestor does not exist yet', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'example'));
    expect(await assertPluginStatePath({ ...effects(), workspaceRoot: root, entryPath: 'example/missing/leaf' }))
      .toBe(path.join(root, 'example', 'missing', 'leaf'));
  });
  test('refuses an ancestor that is a symlink, even one pointing inside the workspace', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'other'));
    await fs.symlink(path.join(root, 'other'), path.join(root, 'example'));
    await expect(assertPluginStatePath({ ...effects(), workspaceRoot: root, entryPath: 'example/memory' }))
      .rejects.toThrow('Plugin state ancestors must not be symlinks');
  });
  test('propagates a realpath failure other than ENOENT', async () => {
    const root = await workspace();
    const filesystem = { ...fs, realpath: (async (target: string) => {
      if (target !== root) throw errno('EACCES');
      return fs.realpath(target);
    }) as Filesystem['realpath'] };
    await expect(assertPluginStatePath({ ...effects(filesystem), workspaceRoot: root, entryPath: 'example' }))
      .rejects.toMatchObject({ code: 'EACCES' });
  });
});

describe('withPluginStateLock', () => {
  test('creates the workspace and holds a staging lock named for the plugin around run', async () => {
    const root = path.join(await workspace(), 'nested-ws');
    locks.length = 0;
    expect(await withPluginStateLock({ ...effects(), workspaceRoot: root, pluginId: 'example', run: async () => 'ran' })).toBe('ran');
    expect(locks).toEqual([path.join(root, 'staging', '.plugin-state-example.lock')]);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });
  test('validates the plugin id before touching the filesystem', async () => {
    const root = path.join(await workspace(), 'never-created');
    await expect(withPluginStateLock({ ...effects(), workspaceRoot: root, pluginId: 'Bad', run: async () => 'ran' }))
      .rejects.toThrow('Invalid plugin state root or id');
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createPluginMemory', () => {
  test.each([
    [{ files: 0 }], [{ notes: 1.5 }], [{ learned: DEFAULT_PLUGIN_MEMORY_LIMITS.learned + 1 }],
  ])('refuses caps %j that are not positive integers within the host ceiling', limits => {
    expect(() => createPluginMemory({ ...effects(), workspaceRoot: '/ws', pluginId: 'example' }, { limits }))
      .toThrow('Memory caps must be positive and cannot exceed host ceilings');
  });

  test('writes, overwrites and lists nested notes and learned files in name order', async () => {
    const root = await workspace();
    const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { files: 2 } });
    expect(await memory.writeNote({ entryPath: 'b/inner.md', text: 'inner' })).toEqual({ relativePath: 'b/inner.md', bytes: 5 });
    expect(await memory.writeNote({ entryPath: 'a.md', text: 'first' })).toEqual({ relativePath: 'a.md', bytes: 5 });
    // At the file cap, replacing an existing file is still allowed; its old bytes leave the total.
    expect(await memory.writeNote({ entryPath: 'a.md', text: 'second é' })).toEqual({ relativePath: 'a.md', bytes: 9 });
    expect(await memory.list({ kind: 'notes' })).toEqual([
      { relativePath: 'a.md', text: 'second é' }, { relativePath: 'b/inner.md', text: 'inner' },
    ]);
    await memory.learned.write({ entryPath: 'cache.json', text: '{}' });
    expect(await memory.learned.read({ entryPath: 'cache.json' })).toBe('{}');
    expect(await memory.read({ kind: 'notes', entryPath: 'b/inner.md' })).toBe('inner');
    expect((await fs.readdir(path.join(root, 'example', 'memory', 'notes'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  test('lists nothing when the workspace or the memory kind does not exist yet', async () => {
    const missing = path.join(await workspace(), 'absent');
    expect(await createPluginMemory({ ...effects(), workspaceRoot: missing, pluginId: 'example' }).list({ kind: 'notes' })).toEqual([]);
    const root = await workspace();
    await fs.mkdir(path.join(root, 'example'));
    expect(await createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }).list({ kind: 'learned' })).toEqual([]);
  });

  test('refuses an unknown memory kind on read, list and write', async () => {
    const root = await workspace();
    const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' });
    const kind = 'secrets' as 'notes';
    await expect(memory.read({ kind, entryPath: 'x' })).rejects.toThrow('Invalid memory kind');
    await expect(memory.list({ kind })).rejects.toThrow('Invalid memory kind');
  });

  test.each([
    ['a non-string', 42 as unknown as string],
    ['a NUL byte', 'a\0b'],
    ['a lone surrogate', 'bad \ud800'],
  ])('refuses text with %s before taking the lock', async (_label, text) => {
    const root = await workspace();
    locks.length = 0;
    await expect(createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }).writeNote({ entryPath: 'n.md', text }))
      .rejects.toThrow('Memory must be valid UTF-8 text');
    expect(locks).toEqual([]);
  });

  test('refuses a single write larger than the kind cap', async () => {
    const root = await workspace();
    const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { learned: 4 } });
    await expect(memory.learned.write({ entryPath: 'big', text: '12345' })).rejects.toThrow('Memory byte cap exceeded');
  });

  test('refuses a new file at the file cap and a write that would push the total over the byte cap', async () => {
    const root = await workspace();
    const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { files: 1, notes: 8 } });
    await memory.writeNote({ entryPath: 'one.md', text: '12345' });
    await expect(memory.writeNote({ entryPath: 'two.md', text: '1' })).rejects.toThrow('Memory cap exceeded');
    const roomy = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { files: 2, notes: 8 } });
    await expect(roomy.writeNote({ entryPath: 'two.md', text: '1234' })).rejects.toThrow('Memory cap exceeded');
    expect(await roomy.list({ kind: 'notes' })).toEqual([{ relativePath: 'one.md', text: '12345' }]);
  });

  test('removes the temporary file when the final rename fails', async () => {
    const root = await workspace();
    const filesystem = { ...fs, rename: (async () => { throw errno('EXDEV'); }) as Filesystem['rename'] };
    const memory = createPluginMemory({ ...effects(filesystem), workspaceRoot: root, pluginId: 'example' });
    await expect(memory.writeNote({ entryPath: 'n.md', text: 'x' })).rejects.toMatchObject({ code: 'EXDEV' });
    expect(await fs.readdir(path.join(root, 'example', 'memory', 'notes'))).toEqual([]);
  });

  describe('reading refuses files that are not bounded UTF-8 text', () => {
    async function seeded(relative: string, contents: string | Buffer, limits = {}) {
      const root = await workspace();
      await put(root, `example/memory/notes/${relative}`, contents);
      return createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits });
    }
    test('a directory read as a file', async () => {
      const memory = await seeded('dir/inner.md', 'x');
      await expect(memory.read({ kind: 'notes', entryPath: 'dir' })).rejects.toThrow('Memory must contain regular UTF-8 files');
    });
    test('a file that grew past the cap outside the writer', async () => {
      const memory = await seeded('big.md', '123456789', { notes: 8 });
      await expect(memory.read({ kind: 'notes', entryPath: 'big.md' })).rejects.toThrow('Memory byte cap exceeded');
    });
    test('a file holding a NUL byte', async () => {
      const memory = await seeded('nul.md', 'a\0b');
      await expect(memory.read({ kind: 'notes', entryPath: 'nul.md' })).rejects.toThrow('Memory must be UTF-8 text');
    });
    test('a file holding invalid UTF-8', async () => {
      const memory = await seeded('bad.md', Buffer.from([0xff, 0xfe]));
      await expect(memory.read({ kind: 'notes', entryPath: 'bad.md' })).rejects.toThrow(TypeError);
    });
  });

  describe('listing enforces caps and refuses non-regular entries', () => {
    test('too many entries, counting directories, hits the entry cap', async () => {
      const root = await workspace();
      for (const name of ['a', 'b', 'c', 'd', 'e']) await fs.mkdir(path.join(root, 'example', 'memory', 'notes', name), { recursive: true });
      const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { files: 1 } });
      await expect(memory.list({ kind: 'notes' })).rejects.toThrow('Memory entry cap exceeded');
    });
    test('more files than the file cap', async () => {
      const root = await workspace();
      await put(root, 'example/memory/notes/a.md', 'a');
      await put(root, 'example/memory/notes/b.md', 'b');
      const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' }, { limits: { files: 1 } });
      await expect(memory.list({ kind: 'notes' })).rejects.toThrow('Memory file cap exceeded');
    });
    test('a symlink inside memory', async () => {
      const root = await workspace();
      await put(root, 'outside.md', 'secret');
      await fs.mkdir(path.join(root, 'example', 'memory', 'notes'), { recursive: true });
      await fs.symlink(path.join(root, 'outside.md'), path.join(root, 'example', 'memory', 'notes', 'link.md'));
      const memory = createPluginMemory({ ...effects(), workspaceRoot: root, pluginId: 'example' });
      await expect(memory.list({ kind: 'notes' })).rejects.toThrow('Memory symlinks and special files are refused');
    });
    test('a nested directory that cannot be read is an error, not an empty listing', async () => {
      const root = await workspace();
      await put(root, 'example/memory/notes/sub/a.md', 'a');
      const filesystem = { ...fs, readdir: (async (target: string, options: { withFileTypes: true }) => {
        if (target.endsWith(`${path.sep}sub`)) throw errno('ENOENT');
        return fs.readdir(target, options);
      }) as unknown as Filesystem['readdir'] };
      const memory = createPluginMemory({ ...effects(filesystem), workspaceRoot: root, pluginId: 'example' });
      await expect(memory.list({ kind: 'notes' })).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});

describe('migratePluginLayout', () => {
  async function migrate(root: string, overrides: Partial<Filesystem> = {}, lock = withLock) {
    const events: { event: string; message: string }[] = [];
    const result = await migratePluginLayout({ filesystem: { ...fs, ...overrides }, contain, withLock: lock, workspaceRoot: root,
      parsePluginId, onEvent: event => events.push(event) });
    return { result, events, names: events.map(event => event.event) };
  }
  const digest = 'a'.repeat(64);

  test('moves a legacy package (keeping it frozen) and legacy memory/data into Layout B, then writes the marker', async () => {
    const root = await workspace();
    await put(root, `packages/sha256/${digest}/plugin.json`, manifest('example'));
    await fs.chmod(path.join(root, 'packages', 'sha256', digest), 0o555);
    await put(root, 'memory/example/notes/n.md', 'note');
    await put(root, 'data/example/cache', 'state');
    const { result, names } = await migrate(root);
    expect(result).toEqual({ complete: true, moved: 3 });
    expect(names.filter(name => name === 'migration-moved')).toHaveLength(3);
    expect(names.at(-1)).toBe('migration-complete');
    const packageRoot = path.join(root, 'example', 'package', 'sha256', digest);
    expect(JSON.parse(await fs.readFile(path.join(packageRoot, 'plugin.json'), 'utf8'))).toEqual({ name: 'example' });
    expect((await fs.stat(packageRoot)).mode & 0o777).toBe(0o555);
    expect(await fs.readFile(path.join(root, 'example', 'memory', 'notes', 'n.md'), 'utf8')).toBe('note');
    expect(await fs.readFile(path.join(root, 'example', 'data', 'cache'), 'utf8')).toBe('state');
    for (const gone of ['packages', 'memory', 'data']) await expect(fs.stat(path.join(root, gone))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await fs.readFile(path.join(root, '.agent-plugin-layout-migrated'), 'utf8'))).toEqual({ layoutVersion: 2 });
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  test('reports an unreadable completion marker and migrates again instead of trusting it', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, '.agent-plugin-layout-migrated'), 'not json');
    const { result, events } = await migrate(root);
    expect(result).toEqual({ complete: true, moved: 0 });
    expect(events[0]).toMatchObject({ event: 'migration-marker-invalid' });
    expect(events[0]!.message).toContain('SyntaxError');
    expect(JSON.parse(await fs.readFile(path.join(root, '.agent-plugin-layout-migrated'), 'utf8'))).toEqual({ layoutVersion: 2 });
  });

  test('a marker from an older layout version is ignored silently and rewritten', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, '.agent-plugin-layout-migrated'), JSON.stringify({ layoutVersion: 1 }));
    const { result, names } = await migrate(root);
    expect(result).toEqual({ complete: true, moved: 0 });
    expect(names).toEqual(['migration-complete']);
  });

  test('a non-errno manifest parse failure quarantines the legacy package', async () => {
    const root = await workspace();
    await put(root, `packages/sha256/${digest}/plugin.json`, manifest('example'));
    const events: string[] = [];
    const result = await migratePluginLayout({ ...effects(), workspaceRoot: root, onEvent: ({ event }) => events.push(event),
      parsePluginId: () => { throw 'manifest refused'; } });
    expect(result).toEqual({ complete: true, moved: 0 });
    expect(events).toEqual(['migration-quarantined', 'migration-complete']);
  });

  test('a filesystem failure while reading a manifest stays resumable rather than quarantining', async () => {
    const root = await workspace();
    await put(root, `packages/sha256/${digest}/plugin.json`, manifest('example'));
    const { result, events } = await migrate(root, { readFile: (async (target: string, encoding: BufferEncoding) => {
      if (target.endsWith('plugin.json')) throw errno('EIO');
      return fs.readFile(target, encoding);
    }) as Filesystem['readFile'] });
    expect(result).toEqual({ complete: false, moved: 0 });
    expect(events).toEqual([{ event: 'migration-failed', message: `${digest}: Error: EIO: injected` }]);
    expect((await fs.stat(path.join(root, 'packages', 'sha256', digest))).isDirectory()).toBe(true);
  });

  test('a destination stat failure other than ENOENT fails that entry and withholds the marker', async () => {
    const root = await workspace();
    await put(root, 'data/example/cache', 'state');
    const { result, events } = await migrate(root, { stat: (async (target: string) => {
      if (target === path.join(root, 'example', 'data')) throw errno('EACCES');
      return fs.stat(target);
    }) as Filesystem['stat'] });
    expect(result).toEqual({ complete: false, moved: 0 });
    expect(events).toEqual([{ event: 'migration-failed', message: 'data/example: Error: EACCES: injected' }]);
    expect(await fs.readFile(path.join(root, 'data', 'example', 'cache'), 'utf8')).toBe('state');
    await expect(fs.stat(path.join(root, '.agent-plugin-layout-migrated'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a held plugin lock fails Layout B folder repair and withholds the marker', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'example', 'package', 'sha256', digest), { recursive: true });
    const refuse = <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }) =>
      lockPath.includes('.plugin-state-') ? Promise.reject(new Error('lock held')) : run();
    const { result, events } = await migrate(root, {}, refuse);
    expect(result).toEqual({ complete: false, moved: 0 });
    expect(events).toEqual([{ event: 'migration-failed', message: 'example: Error: lock held' }]);
  });

  test('re-freezes Layout B packages and creates their mutable directories once everything moved', async () => {
    const root = await workspace();
    const packageRoot = path.join(root, 'example', 'package', 'sha256', digest);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.mkdir(path.join(root, 'example', 'package', 'sha256', 'not-a-digest'));
    const { result } = await migrate(root);
    expect(result).toEqual({ complete: true, moved: 0 });
    expect((await fs.stat(packageRoot)).mode & 0o777).toBe(0o555);
    for (const child of ['memory/learned', 'memory/notes', 'data']) expect((await fs.stat(path.join(root, 'example', child))).isDirectory()).toBe(true);
  });

  test('a legacy directory listing failure other than ENOENT aborts the migration', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'packages', 'sha256'), { recursive: true });
    const failing = { readdir: (async (target: string, options: { withFileTypes: true }) => {
      if (target === path.join(root, 'packages', 'sha256')) throw errno('EIO');
      return fs.readdir(target, options);
    }) as unknown as Filesystem['readdir'] };
    await expect(migrate(root, failing)).rejects.toMatchObject({ code: 'EIO' });
    await expect(fs.stat(path.join(root, '.agent-plugin-layout-migrated'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('an unexpected failure removing an emptied legacy directory aborts before the marker', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'memory'));
    await expect(migrate(root, { rmdir: (async () => { throw errno('EBUSY'); }) as Filesystem['rmdir'] }))
      .rejects.toMatchObject({ code: 'EBUSY' });
    await expect(fs.stat(path.join(root, '.agent-plugin-layout-migrated'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
