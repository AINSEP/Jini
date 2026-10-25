import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ProjectFilesystemPort } from '../core/project-filesystem.js';
import { ProjectError, type ProjectLimits, type RevisionToken } from '../core/project.js';
import { assertCandidatePaths, portablePathKey, type ProjectPaths } from './paths.js';

export interface ManifestFile { readonly path: string; readonly hash: string; readonly size: number }
export interface Manifest { readonly version: 1; readonly files: readonly ManifestFile[] }
interface Fingerprint { readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
function fingerprint(info: Fingerprint): Fingerprint {
  return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
}
function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
/** Parents of removed managed files, deepest paths pruned first by callers. */
function removedFolders({ before, after }: { before: Manifest; after: Manifest }): Set<string> {
  const kept = new Set(after.files.map(file => file.path)), folders = new Set<string>();
  for (const file of before.files) {
    if (kept.has(file.path)) continue;
    for (let folder = dirname(file.path); folder !== '.'; folder = dirname(folder)) folders.add(folder);
  }
  return folders;
}
export interface Current {
  readonly version: 1;
  readonly root: string;
  readonly revision: string;
  readonly generation: number;
  readonly pending: { readonly from: string | null } | null;
  readonly observed: Readonly<Record<string, Fingerprint>>;
}
export type StoreCheckpoint = 'objects' | 'manifest' | 'journal' | 'delete' | 'write' | 'prune' | 'clear';
export interface StoreInput { root: string; stateDir: string; paths: ProjectPaths; limits: ProjectLimits; filesystem: ProjectFilesystemPort }
export interface StoreOptions {
  /** Internal deterministic process-crash seam; never needed by the public factory. */
  checkpoint?: (input: { step: StoreCheckpoint }) => void | Promise<void>;
}
const HASH = /^[a-f0-9]{64}$/;

/** Immutable object/revision IDs are SHA-256 of their exact bytes. */
export function digest({ bytes }: { bytes: Uint8Array | string }, _options = {}): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function inside(base: string, target: string): boolean {
  const child = relative(base, target);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}
function corrupt(message: string): never { throw new ProjectError({ code: 'CORRUPT', message }); }
function assertHash(hash: string): void { if (!HASH.test(hash)) corrupt('invalid content identifier'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
/** Absent destinations (or a file where a parent folder was expected) are not errors here. */
async function lstatIfPresent(path: string) {
  return fs.lstat(path).catch(error => { if (missing(error) || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined; throw error; });
}
async function statIfPresent(path: string) {
  return fs.stat(path).catch(error => { if (missing(error)) return undefined; throw error; });
}

/** Reject links and special files even when platform containment permits an in-root alias.
 * Host owns the directory; this recheck is not a sandbox against hostile local processes.
 * @complexity O(depth²) bounded containment probes and O(path length) space.
 */
async function regularPath({ paths, path }: { paths: ProjectPaths; path: string }): Promise<string> {
  const absolute = paths.reader.resolve({ relativePath: path });
  const segments = path.split('/');
  for (let end = 1; end <= segments.length; end += 1) {
    const probe = paths.reader.resolve({ relativePath: segments.slice(0, end).join('/') });
    const info = await lstatIfPresent(probe);
    if (!info) continue;
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new ProjectError({ code: 'INVALID_PATH', message: `link or special file refused: ${path}` });
    }
  }
  return absolute;
}
/** Bounded metadata read; malformed JSON is corruption, never a cue to reset a project. */
async function readJson({ path, maxBytes }: { path: string; maxBytes: number }): Promise<unknown> {
  const handle = await fs.open(path, 'r');
  try {
    const bytes = await readBounded({ handle, maxBytes });
    if (bytes.byteLength > maxBytes) corrupt('metadata exceeds project limits');
    try { return JSON.parse(bytes.toString('utf8')); }
    catch (cause) { throw new ProjectError({ code: 'CORRUPT', message: 'invalid project metadata JSON', cause }); }
  } finally { await handle.close(); }
}
/** Read at most maxBytes + 1 so an oversized file is detected without an unbounded buffer. */
async function readBounded({ handle, maxBytes }: { handle: fs.FileHandle; maxBytes: number }): Promise<Buffer> {
  const bytes = Buffer.alloc(maxBytes + 1);
  let count = 0;
  while (count < bytes.length) {
    const result = await handle.read(bytes, count, bytes.length - count, null);
    if (!result.bytesRead) break;
    count += result.bytesRead;
  }
  return bytes.subarray(0, count);
}
/** Validate manifest structure, portable names, policy and aggregate bounds before any I/O. */
function checkManifest({ value, paths, limits }: { value: unknown; paths: ProjectPaths; limits: ProjectLimits }): Manifest {
  const manifest = value as Manifest | null;
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) corrupt('unsupported manifest');
  if (manifest.files.length > limits.maxFiles) corrupt('manifest exceeds file limit');
  let bytes = 0;
  const seen = new Set<string>();
  for (const file of manifest.files) {
    checkManifestFile({ file, paths, limits });
    if (seen.has(file.path)) corrupt('duplicate manifest path');
    seen.add(file.path);
    bytes += file.size;
  }
  if (bytes > limits.maxTreeBytes) corrupt('manifest exceeds tree limit');
  assertCandidatePaths({ paths: [...seen] });
  return manifest;
}
function checkManifestFile({ file, paths, limits }: { file: ManifestFile; paths: ProjectPaths; limits: ProjectLimits }): void {
  if (!file || typeof file.path !== 'string' || typeof file.hash !== 'string') corrupt('invalid manifest file');
  assertHash(file.hash);
  paths.check({ relativePath: file.path });
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) corrupt('invalid manifest size');
}
function checkCurrent({ value, root }: { value: unknown; root: string }): Current {
  const current = value as Current | null;
  if (current?.version !== 1 || current.root !== root) corrupt('stateDir belongs to another root or schema');
  assertHash(current.revision);
  if (!Number.isSafeInteger(current.generation) || current.generation < 1) corrupt('invalid generation');
  checkPending(current.pending);
  checkObserved(current.observed);
  return current;
}
function checkObserved(observed: Current['observed']): void {
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) corrupt('invalid observed file metadata');
  for (const value of Object.values(observed)) checkFingerprint(value);
}
function checkFingerprint(value: Fingerprint): void {
  if (!value || typeof value !== 'object') corrupt('invalid file fingerprint');
  if (!Number.isSafeInteger(value.size) || value.size < 0) corrupt('invalid fingerprint size');
  if (!Number.isFinite(value.mtimeMs) || !Number.isFinite(value.ctimeMs)) corrupt('invalid fingerprint timestamps');
}
function checkPending(pending: Current['pending']): void {
  if (pending === null) return;
  if (typeof pending !== 'object' || !pending || !('from' in pending)) corrupt('invalid pending journal');
  if (pending.from !== null) assertHash(pending.from);
}

/** Host state is physically separate from the watched/served tree, in both directions.
 * @throws ProjectError INVALID_PATH when either canonical directory contains the other.
 * @complexity O(path length) plus constant directory I/O.
 */
export async function prepareDirectories({ root, stateDir }: { root: string; stateDir: string }, _options = {}) {
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const canonicalRoot = await fs.realpath(root), canonicalState = await fs.realpath(stateDir);
  if (inside(canonicalRoot, canonicalState) || inside(canonicalState, canonicalRoot)) {
    throw new ProjectError({ code: 'INVALID_PATH', message: 'stateDir must be outside and separate from the app root' });
  }
  return { root: canonicalRoot, stateDir: canonicalState };
}

/** Content-addressed persistence and idempotent roll-forward. Call mutations inside locked().
 * @complexity O(bytes + files log files + files × depth²) for capture; memory bounded by maxTreeBytes.
 */
export function createProjectStore({ root, stateDir, paths, limits, filesystem }: StoreInput, options: StoreOptions = {}) {
  const currentPath = resolve(stateDir, 'current.json');
  const objectPath = (hash: string) => { assertHash(hash); return resolve(stateDir, 'objects', hash); };
  const manifestPath = (hash: string) => { assertHash(hash); return resolve(stateDir, 'manifests', `${hash}.json`); };
  const checkpoint = async (step: StoreCheckpoint) => { await options.checkpoint?.({ step }); };
  const metadataLimit = limits.maxFiles * 1024 + 4096;

  async function readCurrent(): Promise<Current | null> {
    const value = await readJson({ path: currentPath, maxBytes: metadataLimit }).catch(error => {
      if (missing(error)) return undefined;
      throw error;
    });
    return value === undefined ? null : checkCurrent({ value, root });
  }
  async function manifest({ revisionId }: { revisionId: string }): Promise<Manifest> {
    const value = await readJson({ path: manifestPath(revisionId), maxBytes: metadataLimit });
    const result = checkManifest({ value, paths, limits });
    if (digest({ bytes: JSON.stringify(result) }) !== revisionId) corrupt('manifest digest mismatch');
    return result;
  }
  async function object({ file }: { file: ManifestFile }): Promise<Uint8Array> {
    const handle = await fs.open(objectPath(file.hash), 'r').catch(cause => {
      if (missing(cause)) throw new ProjectError({ code: 'CORRUPT', message: 'referenced object is missing', cause });
      throw cause;
    });
    try {
      const content = await readBounded({ handle, maxBytes: file.size });
      if (content.byteLength !== file.size || digest({ bytes: content }) !== file.hash) corrupt('object digest/size mismatch');
      return content;
    } finally { await handle.close(); }
  }
  /** Prepare every durable dependency before publishing a pending selection. */
  async function prepare({ files }: { files: ReadonlyMap<string, Uint8Array> }): Promise<string> {
    assertCandidatePaths({ paths: [...files.keys()] });
    const entries: ManifestFile[] = [];
    for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const file = { path, hash: digest({ bytes }), size: bytes.byteLength };
      entries.push(file);
    }
    const value = checkManifest({ value: { version: 1, files: entries }, paths, limits });
    for (const file of entries) await writeObject({ file, bytes: files.get(file.path)! });
    await checkpoint('objects');
    const revisionId = digest({ bytes: JSON.stringify(value) });
    const existing = await statIfPresent(manifestPath(revisionId));
    if (existing) await manifest({ revisionId });
    else await filesystem.writeJsonFileAtomicAsync({ filePath: manifestPath(revisionId), data: value }, { createParent: true });
    await checkpoint('manifest');
    return revisionId;
  }
  async function writeObject({ file, bytes }: { file: ManifestFile; bytes: Uint8Array }): Promise<void> {
    const exists = await statIfPresent(objectPath(file.hash));
    if (exists) await object({ file });
    else await filesystem.writeFileAtomicAsync({ filePath: objectPath(file.hash), content: bytes }, { createParent: true });
  }
  async function observations({ files }: Manifest): Promise<Readonly<Record<string, Fingerprint>>> {
    const result: Record<string, Fingerprint> = Object.create(null);
    for (const file of files) {
      const absolute = await regularPath({ paths, path: file.path });
      const info = await fs.stat(absolute);
      const bytes = await paths.reader.readBytes({ relativePath: file.path, maxBytes: limits.maxFileBytes });
      const after = await fs.stat(absolute);
      // A watcher may rewrite a file immediately after a rename. Do not cache its new timestamp
      // against old object bytes: leaving it unobserved makes the next capture hash the drift.
      if (sameFingerprint(info, after) && digest({ bytes }) === file.hash) result[file.path] = fingerprint(info);
    }
    return result;
  }
  /** Capture hashes only files whose disk fingerprint changed; unchanged bytes reuse objects. */
  async function scan({ current }: { current: Current | null }): Promise<{ files: Map<string, Uint8Array>; observed: Record<string, Fingerprint> }> {
    const listed = paths.reader.list({});
    if (listed.truncated) throw new ProjectError({ code: 'LIMIT', message: 'tree traversal exceeded limits' });
    // Host-disallowed files remain unmanaged; malformed allowed names are refused rather than hidden.
    const names = listed.files.filter(relativePath => paths.allows({ relativePath }));
    assertCandidatePaths({ paths: names });
    const base = current ? await manifest({ revisionId: current.revision }) : { files: [] };
    const previous = new Map(base.files.map(file => [file.path, file]));
    const files = new Map<string, Uint8Array>();
    let total = 0;
    const observed: Record<string, Fingerprint> = Object.create(null);
    for (const path of names) {
      const scanned = await scanFile({ path, previous: previous.get(path), observed: current?.observed[path] });
      total += scanned.bytes.byteLength;
      if (total > limits.maxTreeBytes || files.size >= limits.maxFiles) throw new ProjectError({ code: 'LIMIT', message: 'tree exceeds project limits' });
      files.set(path, scanned.bytes);
      observed[path] = scanned.observed;
    }
    return { files, observed };
  }
  async function scanFile({ path, previous, observed }: {
    path: string; previous: ManifestFile | undefined; observed: Fingerprint | undefined;
  }): Promise<{ bytes: Uint8Array; observed: Fingerprint }> {
    paths.check({ relativePath: path });
    const absolute = await regularPath({ paths, path });
    const info = await fs.stat(absolute);
    const bytes = previous && observed && sameFingerprint(info, observed)
      ? await object({ file: previous })
      : await paths.reader.readBytes({ relativePath: path, maxBytes: limits.maxFileBytes });
    const after = await fs.stat(absolute);
    if (!sameFingerprint(info, after)) throw new ProjectError({ code: 'CONFLICT', message: `file changed while capturing: ${path}` });
    return { bytes, observed: fingerprint(info) };
  }
  /** Read a published live file without scanning/re-hashing the whole project for every viewer read. */
  async function readWorkingFile({ relativePath }: { relativePath: string }): Promise<Uint8Array> {
    await regularPath({ paths, path: relativePath });
    return paths.reader.readBytes({ relativePath, maxBytes: limits.maxFileBytes });
  }
  async function removeManaged({ before, after }: { before: Manifest; after: Manifest }): Promise<void> {
    const retained = new Set(after.files.map(file => file.path));
    for (const file of before.files) {
      if (retained.has(file.path)) continue;
      try { await fs.rm(await regularPath({ paths, path: file.path }), { force: true }); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      await checkpoint('delete');
    }
  }
  /** Prune only directories that contained a removed managed file; never recurse into exclusions. */
  async function prune({ before, after }: { before: Manifest; after: Manifest }): Promise<void> {
    const folders = removedFolders({ before, after });
    for (const folder of [...folders].sort((a, b) => b.split('/').length - a.split('/').length)) {
      await pruneFolder({ folder });
    }
    await checkpoint('prune');
  }
  async function pruneFolder({ folder }: { folder: string }): Promise<void> {
    try { await fs.rmdir(await regularPath({ paths, path: folder })); }
    catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  /** On case-insensitive volumes, reusing an empty old directory preserves its old spelling.
   * Remove only empty managed aliases before writes, so a case-only directory rename is real.
   */
  async function pruneRenamedFolders({ before, after }: { before: Manifest; after: Manifest }): Promise<void> {
    const previous = removedFolders({ before, after: { version: 1, files: [] } });
    const next = removedFolders({ before: after, after: { version: 1, files: [] } });
    const aliases = new Map([...next].map(folder => [portablePathKey({ path: folder }), folder]));
    for (const folder of [...previous].sort((a, b) => b.length - a.length)) {
      const alias = aliases.get(portablePathKey({ path: folder }));
      if (alias !== undefined && alias !== folder) await pruneFolder({ folder });
    }
  }
  /** Pre-read/verify every object before the first deletion. Pending remains until all writes land. */
  async function materialize({ current }: { current: Current }): Promise<Current> {
    const after = await manifest({ revisionId: current.revision });
    const before = current.pending?.from ? await manifest({ revisionId: current.pending.from }) : { version: 1 as const, files: [] };
    const previous = new Map(before.files.map(file => [file.path, file.hash]));
    const writes = after.files.filter(file => previous.get(file.path) !== file.hash);
    const bytes = new Map<string, Uint8Array>();
    for (const file of after.files) bytes.set(file.path, await object({ file }));
    await removeManaged({ before, after });
    await pruneRenamedFolders({ before, after });
    // Empty folders blocking a directory-to-file transition must be removed before writing it.
    for (const file of writes) await removeBlockingFolder({ path: file.path, before });
    for (const file of writes) {
      await filesystem.writeFileAtomicAsync({ filePath: await regularPath({ paths, path: file.path }), content: bytes.get(file.path)! },
        { createParent: true, refuseSymlink: true, defaultMode: 0o644 });
      await checkpoint('write');
    }
    await prune({ before, after });
    const settled: Current = { ...current, pending: null, observed: await observations(after) };
    await filesystem.writeJsonFileAtomicAsync({ filePath: currentPath, data: settled });
    await checkpoint('clear');
    return settled;
  }
  async function removeBlockingFolder({ path, before }: { path: string; before: Manifest }): Promise<void> {
    const destination = await regularPath({ paths, path });
    const info = await lstatIfPresent(destination);
    if (!info?.isDirectory()) return;
    const folders = removedFolders({ before, after: { version: 1, files: [] } });
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      if (folder.startsWith(`${path}/`)) await pruneFolder({ folder });
    }
    await fs.rmdir(destination);
  }
  /** Refuse unsafe/unmanaged obstructions before the journal commit point. */
  async function preflight({ current, revisionId }: { current: Current | null; revisionId: string }): Promise<void> {
    const after = await manifest({ revisionId });
    const before: Manifest = current ? await manifest({ revisionId: current.revision }) : { version: 1, files: [] };
    const folders = removedFolders({ before, after });
    const kept = new Set(after.files.map(file => file.path));
    const removed = new Set(before.files.filter(file => !kept.has(file.path)).map(file => file.path));
    const sources = new Map(before.files.map(file => [portablePathKey({ path: file.path }), file.path]));
    await assertRenamedFolders({ before, after, folders, removed });
    for (const file of after.files) {
      await object({ file });
      const target = await regularPath({ paths, path: file.path });
      const info = await lstatIfPresent(target);
      assertManagedDestination({ existsAsFile: info?.isFile() ?? false, path: file.path, sources });
      if (info?.isDirectory()) await assertRemovableFolder({ path: file.path, folders, removed });
    }
  }
  /** An existing filesystem alias must not let a create overwrite a host-disallowed file. */
  function assertManagedDestination({ existsAsFile, path, sources }: {
    existsAsFile: boolean; path: string; sources: ReadonlyMap<string, string>;
  }): void {
    if (!existsAsFile || sources.has(portablePathKey({ path }))) return;
    throw new ProjectError({ code: 'INVALID_CHANGE', message: `unmanaged file blocks ${path}` });
  }
  /** A portable case rename cannot silently retain an unmanaged directory under its old spelling. */
  async function assertRenamedFolders({ before, after, folders, removed }: {
    before: Manifest; after: Manifest; folders: ReadonlySet<string>; removed: ReadonlySet<string>;
  }): Promise<void> {
    const previous = removedFolders({ before, after: { version: 1, files: [] } });
    const next = removedFolders({ before: after, after: { version: 1, files: [] } });
    const aliases = new Map([...next].map(folder => [portablePathKey({ path: folder }), folder]));
    for (const path of previous) {
      const alias = aliases.get(portablePathKey({ path }));
      if (alias !== undefined && alias !== path) await assertRemovableFolder({ path, folders, removed });
    }
  }
  async function assertRemovableFolder({ path, folders, removed }: {
    path: string; folders: ReadonlySet<string>; removed: ReadonlySet<string>;
  }): Promise<void> {
    const inspect = new Set([path, ...[...folders].filter(folder => folder.startsWith(`${path}/`))]);
    for (const folder of inspect) {
      for (const name of await fs.readdir(await regularPath({ paths, path: folder }))) {
        const child = `${folder}/${name}`;
        if (!folders.has(child) && !removed.has(child)) throw new ProjectError({ code: 'INVALID_CHANGE', message: `unmanaged directory contents block ${path}` });
      }
    }
  }
  async function recover(): Promise<Current | null> {
    const current = await readCurrent();
    if (!current) return null;
    try { await manifest({ revisionId: current.revision }); }
    catch (cause) {
      if (missing(cause)) throw new ProjectError({ code: 'CORRUPT', message: 'current manifest is missing', cause });
      throw cause;
    }
    return current.pending ? materialize({ current }) : current;
  }
  /** Journal is the commit point. Reopen rolls it forward; no rollback or guessed replacement. */
  async function select({ current, revisionId, captured }: {
    current: Current | null; revisionId: string; captured?: Readonly<Record<string, Fingerprint>> | undefined;
  }): Promise<Current> {
    await manifest({ revisionId });
    if (current?.generation === Number.MAX_SAFE_INTEGER) throw new ProjectError({ code: 'LIMIT', message: 'generation exhausted' });
    const next: Current = { version: 1, root, revision: revisionId, generation: (current?.generation ?? 0) + 1,
      pending: captured ? null : { from: current?.revision ?? null }, observed: captured ?? {} };
    await filesystem.writeJsonFileAtomicAsync({ filePath: currentPath, data: next });
    await checkpoint('journal');
    return captured ? next : materialize({ current: next });
  }
  /** Refresh a same-content capture's fingerprints without inventing a new revision/generation. */
  async function observe({ current, observed }: { current: Current; observed: Current['observed'] }): Promise<Current> {
    if (JSON.stringify(current.observed) === JSON.stringify(observed)) return current;
    const next = { ...current, observed };
    await filesystem.writeJsonFileAtomicAsync({ filePath: currentPath, data: next });
    return next;
  }
  /** Both stacks pin manifests and blobs. Expired snapshots do not pin storage indefinitely. */
  async function collect({ revisions }: { revisions: ReadonlySet<string> }): Promise<void> {
    const objects = new Set<string>();
    for (const revisionId of revisions) {
      for (const file of (await manifest({ revisionId })).files) objects.add(file.hash);
    }
    await removeUnreferenced({ directory: resolve(stateDir, 'manifests'), keep: new Set([...revisions].map(id => `${id}.json`)) });
    await removeUnreferenced({ directory: resolve(stateDir, 'objects'), keep: objects });
  }
  return {
    readCurrent, manifest, object, prepare, scan, select, collect, preflight, observe, readWorkingFile,
    locked: <T>(run: () => Promise<T>) => filesystem.withFileLock({ lockPath: resolve(stateDir, 'project.lock'), run }, { staleMs: Infinity, createParent: true }),
    recover,
  };
}
/** Generated orphan objects/manifests are safe to discard only while holding the project lock. */
async function removeUnreferenced({ directory, keep }: { directory: string; keep: ReadonlySet<string> }): Promise<void> {
  const names = await fs.readdir(directory).catch(error => { if (missing(error)) return []; throw error; });
  for (const name of names) {
    if (!keep.has(name)) await fs.rm(resolve(directory, name), { force: true });
  }
}
export function revisionToken({ current }: { current: Current }, _options = {}): RevisionToken {
  return { revisionId: current.revision, generation: current.generation };
}
export type ProjectStore = ReturnType<typeof createProjectStore>;
