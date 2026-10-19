/** Site-scoped source authoring. Drafts never enter discovery; publication belongs to the
 * existing installer. Node filesystem effects live here, host SDK/policy/reload stay ports. */
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as semver from 'semver';
import { withFileLock, FileLockTimeoutError, type FileLockOptions } from '@jini-ai/platform/fs/file-lock';
import { validateManifest, validatePluginIdFormat } from '../manifest.js';
import { PLUGIN_MANIFEST_FILENAME as MANIFEST, LEGACY_PLUGIN_MANIFEST_FILENAME, PLUGIN_MANIFEST_FILENAMES, canonicalizePluginManifest } from '../plugin-format.js';
import type { ManifestHostPorts } from '../ports.js';
import type { PluginSourcePolicyPort } from '../source-policy.js';
import { computePluginIntegrity, digestSitePluginSnapshot, snapshotSitePluginPackage, type PluginInstallerPort, type PluginInstallPreview, type PluginPackageSnapshot } from './install.js';

export class PluginSourceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PluginSourceError'; }
}
export const PLUGIN_SOURCE_LIMITS = { maxFileBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxEntries: 512 } as const;
type Options = Record<string, never>;
type Id = { id: string };
type File = Id & { path: string };
export interface PluginSourceSealResult {
  readonly installed: true;
  readonly plugin: PluginInstallPreview;
  readonly reloaded: boolean;
  readonly reloadError?: string;
  readonly rollbackFrom?: string;
}
/** Only relative paths and model-facing facts cross this port; no local filesystem handles. */
export interface PluginSourcePort {
  create(required: Id & { name: string; description: string }, optional?: Options): Promise<{ created: boolean }>;
  open(required: Id, optional?: Options): Promise<{ created: boolean }>;
  list(required: Id, optional?: Options): Promise<{ files: readonly { path: string; bytes: number }[] }>;
  read(required: File, optional?: Options): Promise<{ content: string; bytes: number; digest: string }>;
  write(required: File & { content: string }, optional?: Options): Promise<{ bytesWritten: number }>;
  edit(required: File & { oldString: string; newString: string; replaceAll?: boolean }, optional?: Options): Promise<{ bytesWritten: number; replacements: number }>;
  delete(required: File, optional?: { expectedDigest?: string }): Promise<{ deleted: true }>;
  seal(required: Id, optional?: Options): Promise<PluginSourceSealResult>;
  rollback(required: Id, optional?: Options): Promise<PluginSourceSealResult>;
  isSealedHere(required: Id & { version: string }, optional?: Options): Promise<boolean>;
  /** The capability set (`pluginCapabilitySet`) the owner last approved for this id, if any. */
  readApproval(required: Id, optional?: Options): Promise<readonly string[] | undefined>;
  /** Host-only: called after the owner confirmed an enable. Never exposed as a model tool. */
  recordApproval(required: Id & { capabilities: readonly string[] }, optional?: Options): Promise<void>;
}
export interface PluginSourceDeps extends ManifestHostPorts {
  readonly installDir: string;
  readonly builtInIds: readonly string[];
  readonly installer: PluginInstallerPort;
  readonly policy: PluginSourcePolicyPort;
  /** Host-specific opt-in instructions; omitted hosts receive a neutral refusal. */
  readonly localInstallDisabledMessage?: string;
  /** Host ABI text, avoiding an external site's dependency on npm package resolution. */
  readonly scaffoldEntry: string;
  /** Re-enters the validated runtime loader; returns false when this workspace has it OFF. */
  readonly reload: (required: Id, optional?: Options) => Promise<boolean>;
  /** Installer-owned retention runs only after reload succeeds; preserves every active pointer. */
  readonly pruneVersions: (required: Id, optional?: Options) => Promise<readonly string[]>;
}
function fail(code: string, message: string): never { throw new PluginSourceError(code, message); }
function safeId(id: string): void {
  if (typeof id !== 'string' || validatePluginIdFormat({ id }, {}).length) fail('PLUGIN_SOURCE_PATH_INVALID', 'Use a lowercase plugin id of at most 50 characters containing letters, numbers and hyphens.');
}
/** Reject both POSIX and Windows absolute/traversal syntax, even on a POSIX host. */
function safeFile(file: string): void {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('PLUGIN_SOURCE_PATH_INVALID', 'File paths must be relative to the draft, without .., absolute paths or empty segments.');
  }
}
async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Checks every existing segment, including the configured root. Like the installer, this
 * rejects links and hardlinks; a hostile concurrent native process is outside this boundary. */
async function confined(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative) safeFile(relative.split(path.sep).join('/'));
  let current = root;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    await assertUnlinkedSegment(current, target);
  }
}
/** One existing path segment: never a link or hardlink, and a directory unless it is the target. */
async function assertUnlinkedSegment(current: string, target: string): Promise<void> {
  if (!await exists(current)) return;
  const info = await lstat(current);
  if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) fail('PLUGIN_SOURCE_PATH_INVALID', 'Draft and installed paths must not contain symbolic or hard links.');
  if (current !== target && !info.isDirectory()) fail('PLUGIN_SOURCE_PATH_INVALID', 'A parent path is not a directory.');
}
/** Whole-file writes publish by rename, so readers cannot observe a half-written file. */
async function writeAtomic(root: string, target: string, bytes: Buffer): Promise<void> {
  await confined(root, target);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(target), '.write-'));
  try {
    const file = path.join(temporary, 'file');
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    await confined(root, target);
    await rename(file, target);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
function jsonBytes(value: unknown): Buffer { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
/** Path segments and bytes of one draft write, bounded before any filesystem probe. */
function draftWriteInput(file: string, content: string): { segments: string[]; bytes: Buffer } {
  // Bound path depth before filesystem probes can fail with an OS-specific path-length error.
  const segments = file.split('/');
  if (segments.length > PLUGIN_SOURCE_LIMITS.maxEntries) fail('PLUGIN_SOURCE_TOO_LARGE', 'Draft exceeds 512 entries.');
  if (typeof content !== 'string') fail('PLUGIN_SOURCE_INPUT_INVALID', 'File content must be a string.');
  const bytes = Buffer.from(content);
  if (bytes.length > PLUGIN_SOURCE_LIMITS.maxFileBytes) fail('PLUGIN_SOURCE_TOO_LARGE', 'A draft file may contain at most 1 MiB.');
  return { segments, bytes };
}
/** How many of the write's path segments do not exist yet under `base`. */
async function missingSegmentCount(base: string, segments: readonly string[]): Promise<number> {
  let missing = 0;
  for (let index = 1; index <= segments.length; index++) {
    if (!await exists(path.join(base, ...segments.slice(0, index)))) missing++;
  }
  return missing;
}
/** The draft's manifest JSON (current name first, then the legacy alias), or a refusal. */
function parseDraftManifest(files: ReadonlyMap<string, Buffer>): unknown {
  const filename = PLUGIN_MANIFEST_FILENAMES.find(name => files.has(name)); // legacy alias
  try { return JSON.parse(filename === undefined ? '' : files.get(filename)!.toString('utf8')); }
  catch { return fail('PLUGIN_MANIFEST_INVALID', `A valid ${MANIFEST} is required.`); }
}
/** A declared version above the latest install is kept; otherwise the latest gets a patch bump. */
function nextSealVersion(latest: string | undefined, declaredVersion: string): string {
  const version = latest && !semver.gt(declaredVersion, latest) ? semver.inc(latest, 'patch') : declaredVersion;
  if (!version) fail('PLUGIN_SOURCE_VERSION_INVALID', 'A valid semantic version is required.');
  return version;
}

/** Build the bounded Node draft adapter.
 * @param required Site path and injected manifest, installer, policy and reload owners.
 * @param optional.temporaryDir External sealing staging root; defaults to the OS temp directory.
 * @returns The source tool port. Typed source/install errors describe refusals; filesystem faults reject.
 * @example createPluginSourceService({ ...host, installDir, installer, policy, reload, builtInIds: [], scaffoldEntry }, {})
 * @complexity O(package bytes) per operation, capped at 8 MiB / 512 entries.
 */
export function createPluginSourceService(required: PluginSourceDeps, optional: { temporaryDir?: string; lockPorts?: Pick<FileLockOptions, 'clock' | 'process' | 'hostname'> } = {}): PluginSourcePort {
  const root = path.resolve(required.installDir);
  const drafts = path.join(root, '.drafts');
  const draft = (id: string) => path.join(drafts, id);
  const marker = (id: string, version: string) => path.join(drafts, '.sealed', id, version, 'digest.json');
  // Beside the per-version provenance markers, so version pruning never removes it and no draft
  // path (ids cannot start with '.') can write it. Per site: one approval covers every workspace.
  const approval = (id: string) => path.join(drafts, '.sealed', id, 'approved.json');

  /** Cross-process source lock serializes edits with seal snapshots. Installer keeps its own
   * publication lock. Platform records pid/time and reclaims only dead owners; age alone must
   * never steal a long seal from a live process. Token-owned release preserves a replacement. */
  async function locked<T>(id: string, action: () => Promise<T>, options: { createRoot?: boolean } = {}): Promise<T> {
    safeId(id);
    if (required.builtInIds.some(builtIn => builtIn.toLowerCase() === id)) fail('PLUGIN_SHADOWS_BUILT_IN', 'Built-in plugin source cannot be edited.');
    await confined(root, root);
    if (options.createRoot) await mkdir(root, { recursive: true });
    else if (!await exists(root)) fail('PLUGIN_SOURCE_DRAFT_MISSING', 'Create or open a plugin draft first.');
    try {
      return await withFileLock({ lockPath: root + '-source-lock', run: action }, { ...optional.lockPorts, timeoutMs: 100, staleMs: Infinity });
    } catch (error) {
      if (error instanceof FileLockTimeoutError) fail('PLUGIN_SOURCE_BUSY', 'Another source operation is in progress. Retry after it finishes.');
      throw error;
    }
  }
  async function versions(id: string): Promise<string[]> {
    const slot = path.join(root, id);
    await confined(root, slot);
    if (!await exists(slot)) return [];
    const entries = (await readdir(slot)).filter(name => !name.startsWith('.'));
    if (entries.some(version => !semver.valid(version))) fail('PLUGIN_SOURCE_VERSION_INVALID', 'Installed plugin has an unrecognized version folder.');
    return entries.sort(semver.rcompare);
  }
  async function snapshot(location: string): Promise<PluginPackageSnapshot> {
    await confined(root, location);
    if (!await exists(location)) fail('PLUGIN_SOURCE_DRAFT_MISSING', 'Open an installed plugin with plugin_source_open or scaffold it with plugin_source_create first.');
    return snapshotSitePluginPackage({ sourceDir: location }, PLUGIN_SOURCE_LIMITS);
  }
  async function putDraft(id: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
    await confined(root, draft(id));
    await confined(root, drafts);
    await mkdir(drafts, { recursive: true });
    const staging = await mkdtemp(path.join(drafts, '.open-'));
    try {
      for (const [file, bytes] of canonicalizePluginManifest({ files })) { safeFile(file); await writeAtomic(root, path.join(staging, file), bytes); } // legacy alias
      await confined(root, draft(id));
      await rename(staging, draft(id));
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async function open(id: string): Promise<{ created: boolean }> {
    await confined(root, draft(id));
    if (await exists(draft(id))) { await snapshot(draft(id)); return { created: false }; }
    const latest = (await versions(id))[0];
    if (!latest) fail('PLUGIN_SOURCE_NOT_INSTALLED', 'No installed version exists. Use plugin_source_create to scaffold this plugin.');
    const files = await snapshot(path.join(root, id, latest));
    await putDraft(id, files);
    return { created: true };
  }
  async function write(id: string, file: string, content: string): Promise<{ bytesWritten: number }> {
    safeFile(file);
    if (file === LEGACY_PLUGIN_MANIFEST_FILENAME) file = MANIFEST; // legacy alias
    const { segments, bytes } = draftWriteInput(file, content);
    const files = await snapshot(draft(id));
    await confined(root, path.join(draft(id), file));
    if (await exists(path.join(draft(id), file)) && (await lstat(path.join(draft(id), file))).isDirectory()) fail('PLUGIN_SOURCE_PATH_INVALID', 'The requested file path is a directory.');
    files.set(file, bytes);
    const total = [...files.values()].reduce((sum, value) => sum + value.length, 0);
    // The snapshot count includes empty directories, which a files-only map would miss.
    const addedEntries = await missingSegmentCount(draft(id), segments);
    if (total > PLUGIN_SOURCE_LIMITS.maxTotalBytes || files.entryCount + addedEntries > PLUGIN_SOURCE_LIMITS.maxEntries) fail('PLUGIN_SOURCE_TOO_LARGE', 'Draft exceeds 8 MiB or 512 entries.');
    await writeAtomic(root, path.join(draft(id), file), bytes);
    if (file === MANIFEST) await rm(path.join(draft(id), LEGACY_PLUGIN_MANIFEST_FILENAME), { force: true }); // legacy alias
    return { bytesWritten: bytes.length };
  }
  async function read(id: string, file: string): Promise<{ content: string; bytes: number; digest: string }> {
    safeFile(file);
    const files = await snapshot(draft(id));
    if (PLUGIN_MANIFEST_FILENAMES.includes(file)) file = PLUGIN_MANIFEST_FILENAMES.find(name => files.has(name)) ?? MANIFEST; // legacy alias
    const bytes = files.get(file);
    if (!bytes) fail('PLUGIN_SOURCE_FILE_MISSING', 'The requested file is not in the draft.');
    return { content: bytes.toString('utf8'), bytes: bytes.length, digest: digestSitePluginSnapshot({ files: new Map([[file, bytes]]) }) };
  }
  function validate(id: string, manifest: unknown): void {
    const errors = validateManifest({ ...required, manifest, folderName: id, builtInIds: required.builtInIds }).errors;
    if (errors.length) fail('PLUGIN_MANIFEST_INVALID', errors.map(error => error.message).join('; '));
  }
  /** Install a sealed, immutable copy outside discovery's tree. No alternate installer or ZIP
   * encoder is needed; the folder installer refuses sources inside its own destination. */
  async function publish(id: string, files: ReadonlyMap<string, Buffer>, rollbackFrom?: string): Promise<PluginSourceSealResult> {
    if (!required.policy.localInstallEnabled({}, {})) fail('PLUGIN_LOCAL_INSTALL_DISABLED', required.localInstallDisabledMessage ?? 'Local plugin install is disabled by the host.');
    const raw = parseDraftManifest(files);
    validate(id, raw);
    const manifest = raw as Record<string, unknown>;
    if (manifest.id !== id) fail('PLUGIN_MANIFEST_INVALID', 'The manifest id must match the draft id.');
    const version = nextSealVersion((await versions(id))[0], String(manifest.version));
    const staging = await mkdtemp(path.join(optional.temporaryDir ?? tmpdir(), 'plugin-source-'));
    try {
      await stageSealedPackage(staging, files, { ...manifest, version });
      const input = { sourceDir: staging };
      const preview = await required.installer.preview(input, { versionAppend: true });
      const plugin = await required.installer.install({ ...input, expectedDigest: preview.digest }, { versionAppend: true });
      // Host-owned, digest-bound provenance cannot be claimed by a manifest or written through
      // a draft path. Tier-3 has full server access by owner decision (2026-10-09), so this is an
      // assistant-tool boundary, not isolation from executing code. TODO: sandbox tier-3 later.
      await writeAtomic(root, marker(id, version), jsonBytes({ digest: plugin.digest }));
      return await reloadAndPrune(id, plugin, rollbackFrom ? { rollbackFrom } : {});
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  /** Writes the draft files, then the manifest with the sealed version and fresh integrity. */
  async function stageSealedPackage(staging: string, files: ReadonlyMap<string, Buffer>, manifest: Record<string, unknown>): Promise<void> {
    for (const [file, bytes] of canonicalizePluginManifest({ files })) { safeFile(file); await writeAtomic(staging, path.join(staging, file), bytes); } // legacy alias
    const integrity = await computePluginIntegrity({ sourceDir: staging });
    await writeAtomic(staging, path.join(staging, MANIFEST), jsonBytes({ ...manifest, integrity }));
  }
  async function reloadAndPrune(id: string, plugin: PluginInstallPreview, rollback: { rollbackFrom?: string }): Promise<PluginSourceSealResult> {
    let reloaded = false;
    try { reloaded = await required.reload({ id }, {}); }
    catch (error) { return { installed: true, plugin, reloaded: false, reloadError: error instanceof Error ? error.message : String(error), ...rollback }; }
    // Failed reloads retain all recovery bytes. The installer owns which versions are safe to
    // retire, including old active pointers belonging to other workspaces.
    for (const retired of await required.pruneVersions({ id }, {})) {
      await confined(root, marker(id, retired));
      await rm(path.dirname(marker(id, retired)), { recursive: true, force: true });
    }
    return { installed: true, plugin, reloaded, ...rollback };
  }

  return {
    create: ({ id, name, description }, _options = {}) => locked(id, async () => {
      if (typeof name !== 'string' || !name.trim() || typeof description !== 'string') fail('PLUGIN_SOURCE_INPUT_INVALID', 'A name and description are required.');
      if (Buffer.byteLength(name + description) > 64 * 1024) fail('PLUGIN_SOURCE_TOO_LARGE', 'Scaffold metadata exceeds 64 KiB.');
      await confined(root, draft(id));
      if (await exists(draft(id)) || (await versions(id)).length) return open(id);
      // Description belongs in README: the host manifest validator forbids that top-level key.
      const manifest = { id, name, version: '0.1.0', engine: 1, sdkRange: '^' + required.pluginSdkBinding.runtimeSdkVersion, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };
      validate(id, manifest);
      await putDraft(id, new Map([[MANIFEST, jsonBytes(manifest)], ['server/index.mjs', Buffer.from(required.scaffoldEntry)], ['README.md', Buffer.from(`${name}\n\n${description}\n\nSite-local tier-3 plugin. Full server access; sandboxing is deferred.\n`)]]));
      const integrity = await computePluginIntegrity({ sourceDir: draft(id) });
      await writeAtomic(root, path.join(draft(id), MANIFEST), jsonBytes({ ...manifest, integrity }));
      return { created: true };
    }, { createRoot: true }),
    open: ({ id }, _options = {}) => locked(id, () => open(id)),
    list: ({ id }, _options = {}) => locked(id, async () => ({ files: [...await snapshot(draft(id))].map(([file, bytes]) => ({ path: file, bytes: bytes.length })) })),
    read: ({ id, path: file }, _options = {}) => locked(id, () => read(id, file)),
    write: ({ id, path: file, content }, _options = {}) => locked(id, () => write(id, file, content)),
    edit: ({ id, path: file, oldString, newString, replaceAll }, _options = {}) => locked(id, async () => {
      if (typeof oldString !== 'string' || !oldString || typeof newString !== 'string' || (replaceAll !== undefined && typeof replaceAll !== 'boolean')) fail('PLUGIN_SOURCE_INPUT_INVALID', 'Provide a nonempty oldString, a newString and optional boolean replaceAll.');
      const { content, bytes } = await read(id, file);
      const parts = content.split(oldString);
      const replacements = parts.length - 1;
      if (!replacements || (replacements > 1 && !replaceAll)) fail('PLUGIN_SOURCE_EDIT_MISMATCH', 'oldString must match exactly once; use more context or replaceAll:true. Nothing was written.');
      // Bound replacement expansion BEFORE joining: many short matches must not allocate a
      // huge string only to have write() refuse it afterwards. write() also checks actual bytes.
      const projectedBytes = bytes + replacements * (Buffer.byteLength(newString) - Buffer.byteLength(oldString));
      if (projectedBytes > PLUGIN_SOURCE_LIMITS.maxFileBytes) fail('PLUGIN_SOURCE_TOO_LARGE', 'An edited draft file may contain at most 1 MiB.');
      return { ...await write(id, file, parts.join(newString)), replacements };
    }),
    delete: ({ id, path: file }, options = {}) => locked(id, async () => {
      const current = await read(id, file);
      if (options.expectedDigest !== undefined && current.digest !== options.expectedDigest) fail('PLUGIN_SOURCE_CHANGED', 'The draft file changed while awaiting approval. Nothing was deleted; review it again.');
      const target = path.join(draft(id), file);
      await confined(root, target);
      await unlink(target);
      return { deleted: true as const };
    }),
    seal: ({ id }, _options = {}) => locked(id, async () => publish(id, await snapshot(draft(id)))),
    rollback: ({ id }, _options = {}) => locked(id, async () => {
      const previous = (await versions(id))[1];
      if (!previous) fail('PLUGIN_SOURCE_NO_ROLLBACK', 'No previous installed version is available.');
      return publish(id, await snapshot(path.join(root, id, previous)), previous);
    }),
    isSealedHere: async ({ id, version }, _options = {}) => {
      safeId(id);
      if (required.builtInIds.some(builtIn => builtIn.toLowerCase() === id) || !await exists(root)) return false;
      // Provenance and installed packages are immutable and published by rename. A read needs
      // no source lock; enabling during a seal must not fail with PLUGIN_SOURCE_BUSY.
      if (!semver.valid(version) || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) return false;
      const provenance = marker(id, version);
      await confined(root, provenance);
      if (!await exists(provenance)) return false;
      const parent = path.dirname(provenance);
      const markers = await snapshotSitePluginPackage({ sourceDir: parent }, PLUGIN_SOURCE_LIMITS);
      const digest = JSON.parse(markers.get(path.basename(provenance))!.toString('utf8')).digest;
      return digest === digestSitePluginSnapshot({ files: await snapshot(path.join(root, id, version)) });
    },
    // Lock-free like isSealedHere: rename-published, and enabling during a seal must not fail BUSY.
    readApproval: async ({ id }, _options = {}) => {
      safeId(id);
      if (!await exists(root)) return undefined;
      await confined(root, approval(id));
      if (!await exists(approval(id))) return undefined;
      // A damaged record means "not approved": the owner is simply asked again.
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(approval(id), 'utf8')).capabilities; } catch { return undefined; }
      return Array.isArray(parsed) && parsed.every(entry => typeof entry === 'string') ? parsed : undefined;
    },
    recordApproval: async ({ id, capabilities }, _options = {}) => {
      safeId(id);
      await mkdir(root, { recursive: true });
      await writeAtomic(root, approval(id), jsonBytes({ capabilities: [...capabilities] }));
    },
  };
}
