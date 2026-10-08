/** Build-free Node entry: effects and policy belong to the host; no product namespaces here. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const DEFAULT_PLUGIN_MEMORY_LIMITS = Object.freeze({ learned: 1024 * 1024, notes: 16 * 1024, files: 128 });
export function pluginStatePaths({ workspaceRoot, pluginId }, _optional = {}) {
  if (!path.isAbsolute(workspaceRoot) || !SAFE_ID.test(pluginId) || pluginId.length > 64 || ['staging', 'packages', 'memory', 'data'].includes(pluginId)) throw new Error('Invalid plugin state root or id');
  const root = path.join(workspaceRoot, pluginId);
  return { root, packages: path.join(root, 'package', 'sha256'), data: path.join(root, 'data'),
    learned: path.join(root, 'memory', 'learned'), notes: path.join(root, 'memory', 'notes') };
}
/** Containment plus ownership: a sibling plugin inside the workspace is still outside this one. */
export async function assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath }, _optional = {}) {
  const absolute = await contain({ root: workspaceRoot, entryPath });
  const realWorkspace = await fs.realpath(workspaceRoot);
  const relative = path.relative(realWorkspace, absolute);
  let current = realWorkspace;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try { if (await fs.realpath(current) !== current) throw new Error('Plugin state ancestors must not be symlinks'); }
    catch (error) { if (code(error) === 'ENOENT') break; throw error; }
  }
  return absolute;
}
function code(error) { return error && typeof error === 'object' ? error.code : undefined; }

/** Lock files are workspace scratch so uninstall cannot delete a lock another process holds. */
export async function withPluginStateLock({ filesystem: fs, contain, workspaceRoot, pluginId, withLock, run }, _optional = {}) {
  pluginStatePaths({ workspaceRoot, pluginId });
  await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  const lockPath = await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: `staging/.plugin-state-${pluginId}.lock` });
  return withLock({ lockPath, run });
}
/** Each instance is bound to one plugin. No read/write method accepts an id or arbitrary root. */
export function createPluginMemory({ filesystem: fs, contain, workspaceRoot, pluginId, withLock }, optional = {}) {
  const paths = pluginStatePaths({ workspaceRoot, pluginId });
  const limits = { ...DEFAULT_PLUGIN_MEMORY_LIMITS, ...optional.limits };
  for (const kind of ['learned', 'notes', 'files']) {
    if (!Number.isSafeInteger(limits[kind]) || limits[kind] <= 0 || limits[kind] > DEFAULT_PLUGIN_MEMORY_LIMITS[kind]) throw new Error('Memory caps must be positive and cannot exceed host ceilings');
  }
  function checkKind(kind) { if (kind !== 'learned' && kind !== 'notes') throw new Error('Invalid memory kind'); }
  async function root(kind, create = false) {
    checkKind(kind);
    if (create) await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, paths[kind]) });
    if (create) await fs.mkdir(paths[kind], { recursive: true, mode: 0o700 });
    return paths[kind];
  }
  async function readText(filename, cap) {
    // A bounded read protects against a concurrent file growing after stat. Invalid UTF-8 is refused.
    const handle = await fs.open(filename, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Memory must contain regular UTF-8 files');
      const bytes = Buffer.alloc(cap + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await handle.read(bytes, size, bytes.length - size, size);
        if (result.bytesRead === 0) break;
        size += result.bytesRead;
      }
      if (size > cap) throw new Error('Memory byte cap exceeded');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
      if (text.includes('\0')) throw new Error('Memory must be UTF-8 text');
      return text;
    } finally { await handle.close(); }
  }
  async function list({ kind }, _optional = {}) {
    const base = await root(kind).catch(error => { if (code(error) === 'ENOENT') return undefined; throw error; });
    if (!base) return [];
    const files = [];
    let total = 0, entriesSeen = 0;
    async function walk(prefix) {
      let entries;
      try { entries = await fs.readdir(path.join(base, prefix), { withFileTypes: true }); }
      catch (error) { if (code(error) === 'ENOENT' && prefix === '') return; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entriesSeen > limits.files * 4) throw new Error('Memory entry cap exceeded');
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const filename = await contain({ root: base, entryPath: relativePath });
        if (entry.isDirectory()) await walk(relativePath);
        else if (entry.isFile()) {
          if (files.length >= limits.files) throw new Error('Memory file cap exceeded');
          const text = await readText(filename, limits[kind] - total);
          total += Buffer.byteLength(text, 'utf8');
          files.push({ relativePath, text });
        } else throw new Error('Memory symlinks and special files are refused');
      }
    }
    await walk('');
    return files;
  }
  async function read({ kind, entryPath }, _optional = {}) {
    const base = await root(kind);
    return readText(await contain({ root: base, entryPath }), limits[kind]);
  }
  async function write({ kind, entryPath, text }, _optional = {}) {
    checkKind(kind);
    if (typeof text !== 'string' || text.includes('\0') || Buffer.from(text, 'utf8').toString('utf8') !== text) throw new Error('Memory must be valid UTF-8 text');
    if (Buffer.byteLength(text, 'utf8') > limits[kind]) throw new Error('Memory byte cap exceeded');
    // The same lock protects total-size accounting for all processes using this plugin.
    return withPluginStateLock({ filesystem: fs, contain, workspaceRoot, pluginId, withLock, run: async () => {
      const base = await root(kind, true);
      const destination = await contain({ root: base, entryPath });
      const normalized = path.relative(base, destination).split(path.sep).join('/');
      const files = await list({ kind });
      const existing = files.find(file => file.relativePath === normalized);
      const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0);
      if ((!existing && files.length >= limits.files) || total - Buffer.byteLength(existing?.text ?? '', 'utf8') + Buffer.byteLength(text, 'utf8') > limits[kind]) throw new Error('Memory cap exceeded');
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await contain({ root: base, entryPath });
      const temporary = path.join(path.dirname(destination), `.memory-${randomUUID()}.tmp`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, destination);
      } finally { await fs.rm(temporary, { force: true }); }
      return { relativePath: normalized, bytes: Buffer.byteLength(text, 'utf8') };
    } });
  }
  // The plugin-facing capability has no notes writer, even if an input tries to supply kind/id.
  return { list, read, writeNote: ({ entryPath, text }, optional = {}) => write({ kind: 'notes', entryPath, text }, optional),
    learned: { read: ({ entryPath }, optional = {}) => read({ kind: 'learned', entryPath }, optional),
      write: ({ entryPath, text }, optional = {}) => write({ kind: 'learned', entryPath, text }, optional) } };
}

/** Interrupted moves are resumable; refused legacy entries are kept in quarantine and reported. */
export async function migratePluginLayout({ filesystem: fs, contain, workspaceRoot, parsePluginId, withLock, onEvent }, _optional = {}) {
  await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  // Containment returns canonical paths; relative moves must use the same root (e.g. /var -> /private/var).
  workspaceRoot = await fs.realpath(workspaceRoot);
  const marker = path.join(workspaceRoot, '.agent-plugin-layout-migrated');
  const emit = (event, message) => onEvent?.({ event, message });
  return withLock({ lockPath: `${marker}.lock`, run: async () => {
    await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.basename(marker) });
    try { if (JSON.parse(await fs.readFile(marker, 'utf8')).layoutVersion === 2) return { complete: true, moved: 0 }; }
    catch (error) { if (code(error) !== 'ENOENT') emit('migration-marker-invalid', String(error)); }
    let complete = true, moved = 0;
    let quarantineRoot;
    async function entries(directory) {
      try { return await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (code(error) === 'ENOENT') return []; throw error; }
    }
    async function renameEntry({ source, destination, frozen }, _optional = {}) {
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const mode = frozen ? (await fs.stat(source)).mode & 0o777 : undefined;
      if (frozen) await fs.chmod(source, mode | 0o700);
      try { await fs.rename(source, destination); }
      catch (error) { if (frozen) await fs.chmod(source, mode).catch(() => undefined); throw error; }
      if (frozen) await fs.chmod(destination, mode);
    }
    async function quarantine({ source, reason, frozen = false }, _optional = {}) {
      // Validate ancestors, then rename the entry itself: even an unsafe symlink is preserved,
      // never followed into another plugin or outside the workspace.
      await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, path.dirname(source)) });
      if (!quarantineRoot) {
        const base = await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: 'staging/legacy-quarantine' });
        await fs.mkdir(base, { recursive: true, mode: 0o700 });
        const candidate = path.join(base, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
        // Exclusive creation prevents a retry or another boot from overwriting saved bytes.
        await fs.mkdir(candidate, { mode: 0o700 });
        quarantineRoot = candidate;
      }
      const destinationParent = await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot,
        entryPath: path.relative(workspaceRoot, path.join(quarantineRoot, path.relative(workspaceRoot, path.dirname(source)))) });
      // Keep the native directory-entry name verbatim, even if it is not a valid portable package
      // path (e.g. a literal backslash on POSIX). The fresh quarantine tree has no existing leaf.
      const destination = path.join(destinationParent, path.basename(source));
      await renameEntry({ source, destination, frozen });
      emit('migration-quarantined', `${source} -> ${destination}: ${reason}`);
    }
    async function move(source, destination, frozen = false) {
      await contain({ root: workspaceRoot, entryPath: path.relative(workspaceRoot, source) });
      await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, destination) });
      let exists = false;
      try { await fs.stat(destination); exists = true; }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
      if (exists) {
        // The Layout B copy wins. This runs under the plugin lock, so no in-flight move is discarded.
        await quarantine({ source, frozen, reason: 'Migration destination already exists; Layout B copy kept' });
        return;
      }
      await renameEntry({ source, destination, frozen });
      moved++;
      emit('migration-moved', `${source} -> ${destination}`);
    }
    const oldPackages = path.join(workspaceRoot, 'packages', 'sha256');
    for (const entry of await entries(oldPackages)) {
      const source = path.join(oldPackages, entry.name);
      try {
        if (!DIGEST.test(entry.name) || !entry.isDirectory()) {
          await quarantine({ source, frozen: entry.isDirectory(), reason: 'Unrecognized legacy package entry' });
          continue;
        }
        let pluginId, paths;
        try {
          await contain({ root: workspaceRoot, entryPath: `packages/sha256/${entry.name}` });
          const manifestPath = await contain({ root: source, entryPath: 'plugin.json' });
          pluginId = parsePluginId({ value: JSON.parse(await fs.readFile(manifestPath, 'utf8')) });
          paths = pluginStatePaths({ workspaceRoot, pluginId });
        } catch (error) {
          // Missing/invalid manifests are refused entries; filesystem failures remain resumable.
          if (code(error) && !['ENOENT', 'EISDIR'].includes(code(error))) throw error;
          await quarantine({ source, frozen: true, reason: String(error) });
          continue;
        }
        await withPluginStateLock({ filesystem: fs, contain, workspaceRoot, pluginId, withLock, run: () => move(source, path.join(paths.packages, entry.name), true) });
      } catch (error) { complete = false; emit('migration-failed', `${entry.name}: ${String(error)}`); }
    }
    // Layout A memory and PLUGIN_DATA may exist without an installed package; migrate them too.
    for (const bucket of ['memory', 'data']) {
      for (const entry of await entries(path.join(workspaceRoot, bucket))) {
        const source = path.join(workspaceRoot, bucket, entry.name);
        try {
          if (!entry.isDirectory()) {
            await quarantine({ source, reason: 'Legacy state is not a directory' });
            continue;
          }
          let paths;
          try { paths = pluginStatePaths({ workspaceRoot, pluginId: entry.name }); }
          catch (error) { await quarantine({ source, reason: String(error) }); continue; }
          await withPluginStateLock({ filesystem: fs, contain, workspaceRoot, pluginId: entry.name, withLock, run: () => move(source, bucket === 'data' ? paths.data : path.join(paths.root, 'memory')) });
        } catch (error) { complete = false; emit('migration-failed', `${bucket}/${entry.name}: ${String(error)}`); }
      }
    }
    for (const folder of await entries(workspaceRoot)) {
      if (!folder.isDirectory() || !SAFE_ID.test(folder.name) || ['staging', 'packages', 'memory', 'data'].includes(folder.name)) continue;
      try {
        await withPluginStateLock({ filesystem: fs, contain, workspaceRoot, pluginId: folder.name, withLock, run: async () => {
          const paths = pluginStatePaths({ workspaceRoot, pluginId: folder.name });
          await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, paths.packages) });
          const digests = (await entries(paths.packages)).filter(digest => digest.isDirectory() && DIGEST.test(digest.name));
          for (const digest of digests) {
            const packageRoot = await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, path.join(paths.packages, digest.name)) });
            // Legacy install froze every package; a crash after rename can leave only its root writable.
            await fs.chmod(packageRoot, 0o555);
          }
          // Wait until legacy memory/data moves have finished before creating destinations for them.
          if (complete && digests.length) for (const directory of [paths.learned, paths.notes, paths.data]) {
            await assertPluginStatePath({ filesystem: fs, contain, workspaceRoot, entryPath: path.relative(workspaceRoot, directory) });
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
          }
        } });
      } catch (error) { complete = false; emit('migration-failed', `${folder.name}: ${String(error)}`); }
    }
    if (complete) {
      for (const directory of [oldPackages, path.dirname(oldPackages), path.join(workspaceRoot, 'memory'), path.join(workspaceRoot, 'data')]) {
        try { await fs.rmdir(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code(error))) throw error; }
      }
      const temporary = `${marker}.${randomUUID()}.tmp`;
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ layoutVersion: 2 }), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      try { await fs.rename(temporary, marker); } finally { await fs.rm(temporary, { force: true }); }
      emit('migration-complete', workspaceRoot);
    }
    return { complete, moved };
  } });
}
