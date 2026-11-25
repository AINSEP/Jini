import { createHash } from "node:crypto";
import type { BigIntStats, Dirent, Stats } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, realpath, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import type { PluginDiscoveryRecord } from "@jini-ai/core/contracts/site/host-node";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import { SiteShareRefusal } from "./share-refusal.js";


/**
 * @file What a site backup is made of, read from this machine: which files on disk each scope switch
 * picks up, the database snapshot, the size limits, re-reading a planned file at push time, and the
 * backup manifest a future restore reads first. No network here — the git-host plugin provider (`source-control/provider-module.ts`) owns
 * GitHub, `tool-registrations.ts` owns the order these run in.
 *
 * The backup folder's layout (paths relative to the folder root):
 * - the manifest file (its name is the host's) — the manifest ({@link buildSiteBackupManifest}).
 * - `database/content.db` — the snapshot ({@link captureDatabaseSnapshot}), rebuilt through the share
 *   policy before upload (`backup-service.ts` `captureBackupDatabase`: no accounts or secrets). NEVER the live
 *   `content.db` file: a plain read of a WAL-mode database can miss committed pages still in
 *   `content.db-wal`. The snapshot comes only from `DbOpsPort.captureRestorePoint` (SQLite's online
 *   backup API), the same consistent copy the gated-mutation restore points use.
 * - `uploads/**` (media), `themes/**` (themes), `agent-plugins/**` and `skills/**` (plugins),
 *   `settings/config.json` and `settings/.site-meta.json` (settings).
 *
 * Deliberately never included, by construction (each scope walks only its own subtree):
 * - `chat.db` and `uploads/chat-attachments/` — chat history, not site content.
 * - `ops/` (the database journal), `out/` (the rendered export, which `source_control_execute_commit`
 *   already pushes), `content.seed.db` and stray `restore-point-*.db` files.
 * - `.mcp.*.json` (MCP server env, can hold tokens) and `.fs-custom-root.json` (a local path).
 * - `agent-plugins/ws/<id>/<plugin>/data/` and the legacy `agent-plugins/ws/<id>/data/` (plugin OAuth
 *   tokens), `staging/` and `packages/superseded-*`.
 * - `.DS_Store` and any `.git` segment.
 * - Symbolic links, never followed: a link to `~/.ssh` inside `themes/` must not ride along. Each
 *   one is reported in `skipped` so the human sees it was left out.
 */

/** One switch in a backup's `include`. */
export type SiteBackupScope = "database" | "media" | "themes" | "plugins" | "settings";

/** Every scope, in the fixed order the manifest and the confirmation dialog list them. */
export const SITE_BACKUP_SCOPES: readonly SiteBackupScope[] = ["database", "media", "themes", "plugins", "settings"];

/** Which scopes a backup includes. */
export type SiteBackupInclude = Record<SiteBackupScope, boolean>;

const MIB = 1024 * 1024;


/** The repository host a backup goes to, as its plugin declares it (`SourceControlHostFacts`): its
 *  name, and the largest single file it accepts in a push (a push with a larger blob is rejected). */
export interface SiteBackupHostLimit {
  readonly label: string;
  readonly maxFileBytes?: number;
}

export interface SiteBackupLimits {
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
}

/** Where the database snapshot lives inside the backup folder (the manifest's own path is the host's). */
export const SITE_BACKUP_DATABASE_PATH = "database/content.db";

/** Structural mirror of the platform's reviewed-file contract: metadata captured when a caller reviews
 *  a file, before its later read. */
export interface ReviewedFile {
  readonly root: string;
  readonly absPath: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly identity: string | null;
  readonly nlink: number;
}

/** Metadata and bytes must come from the same open descriptor. */
export interface ReviewedFileHandle {
  stat(): Promise<Pick<Stats, "isFile" | "size" | "mtimeMs">>;
  stat(options: { bigint: true }): Promise<Pick<BigIntStats, "dev" | "ino">>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

/** Injectable filesystem boundary for deterministic path-swap probes. */
export interface ReviewedFileSystem {
  open(file: string, flags: number): Promise<ReviewedFileHandle>;
  lstat(file: string): Promise<Pick<BigIntStats, "dev" | "ino" | "nlink" | "isSymbolicLink" | "isDirectory">>;
  realpath(file: string): Promise<string>;
}

/** What a site plugin's package lists for a valid, pinned discovery record. */
export interface SitePluginPackageListing {
  readonly rootDir: string;
  readonly files: readonly { readonly relativePath: string; readonly sha256: string | null }[];
}

/** Everything the walk and the reads take from the host. Every member is REQUIRED: the engine carries no host defaults. */
export interface SiteBackupSourceDeps {
  /** The host's share file rules, applied only to the share profile. */
  readonly sharePolicy: {
    readonly excludedSharePath: (required: { path: string }, optional?: { notices?: string[] | undefined }) => boolean;
    readonly validateSharePath: (required: { path: string }) => void;
    readonly checkShareLimits: (required: { files: readonly { path: string; bytes: number }[] }) => void;
  };
  /** Lists a site plugin's package files for a valid record; rejects with the host's path error for an invalid one. */
  readonly listSitePluginPackage: (required: { installDir: string; record: PluginDiscoveryRecord }) => Promise<SitePluginPackageListing>;
  /** True for the error `listSitePluginPackage` rejects with for a damaged or missing package (expected, not logged). */
  readonly isPluginPackagePathError: (error: unknown) => boolean;
  /** Reads a reviewed file's bytes, or `null` when it is no longer the file that was reviewed. */
  readonly readReviewedFile: (required: { file: ReviewedFile }, optional?: { fileSystem?: ReviewedFileSystem | undefined }) => Promise<Buffer | null>;
  /** The `dev:ino` identity of a file, or `null` when the filesystem has none. */
  readonly reviewedFileIdentity: (required: { info: Pick<BigIntStats, "dev" | "ino"> }) => string | null;
  /** The one media note a backup can carry, and why: the bytes are not on this machine. */
  readonly mediaInObjectStorageNote: string;
}

/** Where each scope's bytes live on this machine — resolved once by the composition root
 *  (`server/runtime/composition/deps.ts`'s `createSiteRouteDeps`), so this file never re-derives a
 *  site path itself. */
export interface SiteBackupSources {
  readonly siteDir: string;
  /** `null` when media lives in object storage (the host's media-store override): there is no folder on
   *  this machine to back up, and {@link collectSiteBackupFiles} says so instead of backing up
   *  nothing silently. */
  readonly mediaUploadsDir: string | null;
  /** The effective media provider is remote — read at backup time, since a site-setting choice
   *  (`core.storage.mediaObjectStore`) is not known at boot the way the env override is. When it
   *  answers `true` the uploads folder is not walked (it is not where media lives) and the scope
   *  note is written, exactly as for a `null` {@link mediaUploadsDir}. */
  readonly isMediaRemote?: () => Promise<boolean>;
  readonly themesDir: string;
  /** The installer's own layout (`features/agent-plugins/layout.ts`), never a re-derived path: every
   *  plugin folder the backup reads comes from the same helpers `install.ts` writes through, so a
   *  layout move cannot silently drop installed packages from a backup again. */
  readonly agentPlugins: AgentPluginLayout;
  readonly skillsDir: string;
  /** The site plugin install folder and Jini's discovery of it with the activation pins (the version
   *  boot runs): a share ships only what Jini lists for a valid record. Absent: no plugin ships. */
  readonly sitePlugins?: () => Promise<{ installDir: string; records: readonly PluginDiscoveryRecord[] }>;
}

/** One file on disk a backup will upload. Jini verifies its bigint identity, link count, ancestry,
 *  `bytes` and `mtimeMs` again at push time. */
export interface PlannedDiskFile extends ReviewedFile {
  /** Relative to the backup folder, `/`-separated. A share's site plugin file is already its archive
   *  path (`plugins/<id>/package/<path in the package>`); `absPath` is still the file on disk. */
  readonly path: string;
  readonly bytes: number;
  readonly scope: SiteBackupScope;
  readonly absPath: string;
  readonly mtimeMs: number;
  /** A share's theme or site plugin package file: the sha256 hex of the bytes checked when it was planned, at an
   *  `absPath` reached through no link. {@link readPlannedFile} then returns only those exact bytes, so
   *  what ships is what was checked (size and mtime alone cannot tell a same-size swap). */
  readonly sha256?: string;
}

export interface SkippedSiteBackupFile {
  readonly path: string;
  readonly reason: string;
}

export interface CollectedSiteBackupFiles {
  readonly files: PlannedDiskFile[];
  readonly skipped: SkippedSiteBackupFile[];
  readonly scopeNotes: Partial<Record<SiteBackupScope, string>>;
  readonly notices?: readonly string[];
}

/** Names never backed up wherever they appear. `.publish-staging`/`.publish-previous` are
 *  theme-files publish's own scratch and replaced-tree copies (`features/theme/publish-content.ts`) —
 *  a backup must never capture a half-staged tree. `.storage-secret.json` is a Postgres site's sealed
 *  connection string (`storage-secret.ts`): it lives in the site root, which no scope walks, and is
 *  named here for repository backups too. The share profile retains nested copies with warnings. */
const IGNORED_NAMES = new Set([".DS_Store", ".git", ".publish-staging", ".publish-previous", ".storage-secret.json"]);

const SYMLINK_REASON = "a symbolic link — never followed, so nothing outside the site can ride along";

/** The walk's shared output, appended to in place by every scope. */
interface WalkSink {
  readonly deps: SiteBackupSourceDeps;
  readonly files: PlannedDiskFile[];
  readonly skipped: SkippedSiteBackupFile[];
  readonly fileSystem: SiteBackupWalkFileSystem;
  readonly notices?: string[];
  readonly profile?: "share";
}

/** The filesystem reads used by backup collection, including files removed during the walk. */
export interface SiteBackupWalkFileSystem {
  readonly lstat: (required: { file: string }) => Promise<Stats>;
  readonly lstatBigInt: (required: { file: string }, optional?: Record<string, never>) => Promise<Pick<BigIntStats, "dev" | "ino">>;
  readonly readdir: (required: { dir: string }, optional?: Record<string, never>) => Promise<Dirent[]>;
}

const WALK_FILE_SYSTEM: SiteBackupWalkFileSystem = {
  lstat: ({ file }) => lstat(file),
  lstatBigInt: ({ file }, _optional = {}) => lstat(file, { bigint: true }),
  readdir: ({ dir }, _optional = {}) => readdir(dir, { withFileTypes: true }),
};

function isMissing({ err }: { err: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/** `readdir` that treats a folder that doesn't exist as empty: a site with no themes folder yet has
 *  nothing to back up there, which is not an error. */
async function readdirOrEmpty({ dir, fileSystem }: { dir: string; fileSystem: SiteBackupWalkFileSystem }, _optional: Record<string, never> = {}): Promise<Dirent[]> {
  try {
    return await fileSystem.readdir({ dir });
  } catch (err) {
    if (isMissing({ err })) return [];
    throw err;
  }
}

/**
 * Adds one regular file to the sink, or records why it was left out. `lstat`, never `stat`: a
 * symlink's own metadata, never its target's.
 *
 * @complexity O(1) — two metadata reads, the second preserving bigint file identity.
 */
async function addFile(sink: WalkSink, input: { root: string; absPath: string; relPath: string; scope: SiteBackupScope }): Promise<void> {
  if (sink.profile === "share" && sink.deps.sharePolicy.excludedSharePath({ path: input.relPath }, { notices: sink.notices })) return;
  let info;
  try {
    info = await sink.fileSystem.lstat({ file: input.absPath });
  } catch (err) {
    if (isMissing({ err })) return;
    throw err;
  }
  if (info.isSymbolicLink()) {
    sink.skipped.push({ path: input.relPath, reason: SYMLINK_REASON });
    return;
  }
  if (!info.isFile()) {
    sink.skipped.push({ path: input.relPath, reason: "not a regular file" });
    return;
  }
  checkShareFile({ sink, relPath: input.relPath, info });
  const ids = await sink.fileSystem.lstatBigInt({ file: input.absPath }).catch(err => isMissing({ err }) ? null : Promise.reject(err));
  if (ids === null) return;
  sink.files.push({ path: input.relPath, bytes: info.size, scope: input.scope, root: input.root, absPath: input.absPath, mtimeMs: info.mtimeMs, identity: sink.deps.reviewedFileIdentity({ info: ids }), nlink: info.nlink });
}

/** Sharing refuses existing hardlinks; ordinary backups can preserve files already linked at plan time. */
function checkShareFile({ sink, relPath, info }: { sink: WalkSink; relPath: string; info: Stats }, _options = {}): void {
  if (sink.profile !== "share") return;
  sink.deps.sharePolicy.validateSharePath({ path: relPath });
  if (info.nlink > 1) throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: `Share refuses hardlinked file '${relPath}'.` });
  sink.deps.sharePolicy.checkShareLimits({ files: [...sink.files, { path: relPath, bytes: info.size }] });
}

/**
 * Recursively adds every regular file under `absDir`. Symlinks (to files or folders) are reported
 * and never entered; {@link IGNORED_NAMES} are dropped silently; `excludeTopLevel` names are dropped
 * at the first level only (`uploads/chat-attachments`).
 *
 * @complexity O(entries under `absDir`) filesystem calls; recursion depth is the folder depth.
 */
async function walkTree(sink: WalkSink, input: { root?: string; absDir: string; relDir: string; scope: SiteBackupScope; excludeTopLevel?: ReadonlySet<string> }): Promise<void> {
  if (sink.profile === "share" && !(await enterShareDirectory({ sink, absDir: input.absDir, relDir: input.relDir }))) return;
  const entries = await readdirOrEmpty({ dir: input.absDir, fileSystem: sink.fileSystem });
  for (const entry of entries) {
    if (skippedWalkEntry({ sink, relDir: input.relDir, name: entry.name }, { excludeTopLevel: input.excludeTopLevel })) continue;
    await walkEntry({ sink, entry, root: input.root ?? input.absDir, absDir: input.absDir, relDir: input.relDir, scope: input.scope });
  }
}

/** Share profile: a private folder is not entered, a missing one is empty, a linked or special one refuses. */
async function enterShareDirectory(required: { sink: WalkSink; absDir: string; relDir: string }): Promise<boolean> {
  if (required.sink.deps.sharePolicy.excludedSharePath({ path: required.relDir }, { notices: required.sink.notices })) return false;
  const info = await required.sink.fileSystem.lstat({ file: required.absDir }).catch(err => isMissing({ err }) ? null : Promise.reject(err));
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink()) throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: `Share refuses linked or special directory '${required.relDir}'.` });
  required.sink.deps.sharePolicy.validateSharePath({ path: required.relDir });
  return true;
}

function skippedWalkEntry(required: { sink: WalkSink; relDir: string; name: string }, optional: { excludeTopLevel?: ReadonlySet<string> | undefined }): boolean {
  const { name } = required;
  // Finder writes .DS_Store into any folder it opens; it is junk, never content, so drop it before the share refusal list sees it.
  if (name === ".DS_Store") return true;
  if (required.sink.profile === "share" && required.sink.deps.sharePolicy.excludedSharePath({ path: `${required.relDir}/${name}` }, { notices: required.sink.notices })) return true;
  // A nested credential file is archive content in the share profile; its scan only warns.
  const ignored = IGNORED_NAMES.has(name) && !(required.sink.profile === "share" && name === ".storage-secret.json");
  return ignored || optional.excludeTopLevel?.has(name) === true;
}

async function walkEntry(required: { sink: WalkSink; entry: Dirent; root: string; absDir: string; relDir: string; scope: SiteBackupScope }): Promise<void> {
  const { sink, entry, root, scope } = required;
  const absPath = path.join(required.absDir, entry.name);
  const relPath = `${required.relDir}/${entry.name}`;
  if (entry.isSymbolicLink()) {
    sink.skipped.push({ path: relPath, reason: SYMLINK_REASON });
  } else if (entry.isDirectory()) {
    await walkTree(sink, { root, absDir: absPath, relDir: relPath, scope });
  } else {
    await addFile(sink, { root, absPath, relPath, scope });
  }
}

/** The files each installed-plugin workspace keeps that a restore needs. Everything else there is
 *  left out on purpose: `data/` holds plugin OAuth tokens, `staging/` is a half-finished install,
 *  and `packages/superseded-*` are replaced versions. */
const PLUGIN_WORKSPACE_FILES: ReadonlySet<string> = new Set(["activations.json", "bundled-digests.json"]);

/** `agent-plugins/<path under the layout root>`, `/`-separated. */
function agentPluginsRelPath({ layout, absPath }: { layout: AgentPluginLayout; absPath: string }, _optional: Record<string, never> = {}): string {
  return ["agent-plugins", ...path.relative(layout.root, absPath).split(path.sep)].join("/");
}

/**
 * Walks `absDir` only when it, and every folder between `baseDir` and it, is a real directory: a
 * symlinked `package/` or `memory/` is reported, never entered, and a missing one is nothing to
 * back up.
 *
 * @complexity O(depth from `baseDir`) `lstat`s, plus the walk itself.
 */
async function walkOwnedDir(sink: WalkSink, input: { layout: AgentPluginLayout; baseDir: string; absDir: string }): Promise<void> {
  let current = input.baseDir;
  for (const segment of path.relative(input.baseDir, input.absDir).split(path.sep)) {
    current = path.join(current, segment);
    const info = await sink.fileSystem.lstat({ file: current }).catch((err: unknown) => (isMissing({ err }) ? null : Promise.reject(err)));
    if (info === null) return;
    if (info.isSymbolicLink()) {
      sink.skipped.push({ path: agentPluginsRelPath({ layout: input.layout, absPath: current }), reason: SYMLINK_REASON });
      return;
    }
    if (!info.isDirectory()) return;
  }
  await walkTree(sink, { root: input.layout.workspacesDir, absDir: input.absDir, relDir: agentPluginsRelPath({ layout: input.layout, absPath: input.absDir }), scope: "plugins" });
}

/**
 * The plugins scope's `agent-plugins/` half: per workspace, {@link PLUGIN_WORKSPACE_FILES}, the
 * legacy flat `packages/sha256/**` store (a site not yet migrated to per-plugin folders still has its
 * packages there), and per installed plugin its `package/sha256/**` store and its learned/notes
 * memory — nothing else. Memory is included because it is the site's own record (uninstall offers to
 * keep it); a plugin's `data/` is not, since it holds OAuth tokens. Every path comes from
 * `layout`'s helpers, the same ones the installer writes through.
 *
 * @complexity O(entries under each included folder).
 */
async function walkAgentPlugins(sink: WalkSink, layout: AgentPluginLayout): Promise<void> {
  for (const entry of await readdirOrEmpty({ dir: layout.workspacesDir, fileSystem: sink.fileSystem })) {
    const workspace = installerWorkspace({ sink, layout, entry });
    if (workspace) await walkPluginWorkspace({ sink, layout, workspace });
  }
}

type PluginWorkspace = ReturnType<AgentPluginLayout["forWorkspace"]>;

/** The workspace folder `entry` names, or `null` (reported when it is a link or a foreign folder). */
function installerWorkspace(required: { sink: WalkSink; layout: AgentPluginLayout; entry: Dirent }): PluginWorkspace | null {
  const { sink, layout, entry } = required;
  const absWorkspace = path.join(layout.workspacesDir, entry.name);
  if (entry.isSymbolicLink()) {
    sink.skipped.push({ path: agentPluginsRelPath({ layout, absPath: absWorkspace }), reason: SYMLINK_REASON });
    return null;
  }
  if (!entry.isDirectory()) return null;
  let workspace;
  try {
    workspace = layout.forWorkspace({ workspaceId: entry.name });
  } catch {
    workspace = null;
  }
  // A folder the installer could never have written (an invalid id, or one that only resolves
  // after case-folding to a different folder) is reported rather than walked under a guessed shape.
  if (workspace === null || workspace.root !== absWorkspace) {
    sink.skipped.push({ path: agentPluginsRelPath({ layout, absPath: absWorkspace }), reason: "not a workspace folder the plugin installer writes" });
    return null;
  }
  return workspace;
}

async function walkPluginWorkspace(required: { sink: WalkSink; layout: AgentPluginLayout; workspace: PluginWorkspace }): Promise<void> {
  const { sink, layout, workspace } = required;
  for (const name of PLUGIN_WORKSPACE_FILES) {
    const absPath = path.join(workspace.root, name);
    await addFile(sink, { root: layout.workspacesDir, absPath, relPath: agentPluginsRelPath({ layout, absPath }), scope: "plugins" });
  }
  await walkOwnedDir(sink, { layout, baseDir: workspace.root, absDir: workspace.packages });
  for (const pluginEntry of await readdirOrEmpty({ dir: workspace.root, fileSystem: sink.fileSystem })) await walkInstalledPlugin({ sink, layout, workspace, pluginEntry });
}

async function walkInstalledPlugin(required: { sink: WalkSink; layout: AgentPluginLayout; workspace: PluginWorkspace; pluginEntry: Dirent }): Promise<void> {
  const { sink, layout, workspace, pluginEntry } = required;
  if (PLUGIN_WORKSPACE_FILES.has(pluginEntry.name) || (!pluginEntry.isDirectory() && !pluginEntry.isSymbolicLink())) return;
  let pluginRoot: string;
  try {
    pluginRoot = workspace.pluginRootDir({ pluginId: pluginEntry.name });
  } catch {
    return; // `staging/`, `packages/`, `data/` and anything not named like a plugin id.
  }
  if (pluginEntry.isSymbolicLink()) {
    sink.skipped.push({ path: agentPluginsRelPath({ layout, absPath: pluginRoot }), reason: SYMLINK_REASON });
    return;
  }
  const pluginId = pluginEntry.name;
  for (const absDir of [
    workspace.pluginPackagesDir({ pluginId }),
    workspace.pluginMemoryDir({ pluginId, kind: "learned" }),
    workspace.pluginMemoryDir({ pluginId, kind: "notes" }),
  ]) {
    await walkOwnedDir(sink, { layout, baseDir: pluginRoot, absDir });
  }
}

/**
 * Every file on disk the switched-on scopes pick up. The database scope is never a disk walk — see
 * {@link captureDatabaseSnapshot}.
 *
 * @returns `files` sorted by path, `skipped` (symlinks and non-regular files, each with its reason),
 *   and `scopeNotes` for a scope whose content could not be collected here at all.
 * @throws SiteShareRefusal for unsafe share files or stale themes, or an unexpected filesystem error
 *   (a missing folder is treated as empty).
 * @complexity O(entries + shared theme bytes), plus O(n log n) to sort n files.
 */
export async function collectSiteBackupFiles(input: { sources: SiteBackupSources; include: SiteBackupInclude; deps: SiteBackupSourceDeps }, optional: { fileSystem?: SiteBackupWalkFileSystem; profile?: "share" } = {}): Promise<CollectedSiteBackupFiles> {
  const { sources, include } = input;
  const notices: string[] = [];
  const sink: WalkSink = { deps: input.deps, files: [], skipped: [], notices, fileSystem: optional.fileSystem ?? WALK_FILE_SYSTEM, ...(optional.profile ? { profile: optional.profile } : {}) };
  const scopeNotes: Partial<Record<SiteBackupScope, string>> = {};

  if (include.media) await collectMediaScope({ sink, sources, scopeNotes });
  if (include.themes) await walkTree(sink, { absDir: sources.themesDir, relDir: "themes", scope: "themes" });
  if (include.plugins) await collectPluginScope({ sink, sources });
  if (sink.profile === "share") {
    await collectShareOnlyTrees({ sink, sources, include, scopeNotes });
    await pinShareThemeFiles({ sink, siteDir: sources.siteDir });
  }
  if (include.settings) {
    for (const name of ["config.json", ".site-meta.json"]) {
      await addFile(sink, { root: sources.siteDir, absPath: path.join(sources.siteDir, name), relPath: `settings/${name}`, scope: "settings" });
    }
  }

  sink.files.sort(byPath);
  return { files: sink.files, skipped: sink.skipped, scopeNotes, notices };
}

/** Pins share themes and overrides through the same no-linked-ancestor read as site plugins.
 *  Canonicalize only the trusted site root (macOS's /var can be a link), never the walked descendants.
 *  @throws SiteShareRefusal PLAN_STALE when a theme cannot be read as planned.
 *  @complexity O(files + theme bytes), one verified read and hash per theme; O(largest theme) bytes.
 */
async function pinShareThemeFiles(required: { sink: WalkSink; siteDir: string }): Promise<void> {
  const { files } = required.sink;
  if (!files.some(file => file.scope === "themes")) return;
  const root = await realpath(required.siteDir);
  const sitePrefix = path.resolve(required.siteDir) + path.sep;
  for (const [index, file] of files.entries()) {
    if (file.scope !== "themes") continue;
    // Packaged originals can live outside the site; trust their package root, not the site root.
    // Canonicalize that root once; descendants must still pass the no-linked-ancestor read.
    const inSite = file.absPath.startsWith(sitePrefix);
    const scopeRoot = inSite ? root : await realpath(file.root);
    const relative = path.relative(inSite ? required.siteDir : file.root, file.absPath);
    const planned = { ...file, absPath: path.join(scopeRoot, relative), root: scopeRoot };
    const read = await readDiskFile(planned, { deps: required.sink.deps, unlinkedPath: true });
    if (!read.ok) throw new SiteShareRefusal({ code: "PLAN_STALE", message: read.message });
    files[index] = { ...planned, sha256: sha256Hex({ bytes: read.bytes }) };
  }
}

/** Code-unit order: -1, 0 or 1, the same as `a < b ? -1 : a > b ? 1 : 0`. */
function byPath(a: { path: string }, b: { path: string }): number {
  return Number(a.path > b.path) - Number(a.path < b.path);
}

/** The uploads folder, minus chat attachments; object-storage media is noted, never silently empty. */
async function collectMediaScope(required: { sink: WalkSink; sources: SiteBackupSources; scopeNotes: Partial<Record<SiteBackupScope, string>> }): Promise<void> {
  const { mediaUploadsDir, isMediaRemote } = required.sources;
  if (mediaUploadsDir === null || (await isMediaRemote?.())) required.scopeNotes.media = required.sink.deps.mediaInObjectStorageNote;
  else await walkTree(required.sink, { absDir: mediaUploadsDir, relDir: "uploads", scope: "media", excludeTopLevel: new Set(["chat-attachments"]) });
}

/** Installed agent plugins and skills; a share first refuses a linked or special plugin root. */
async function collectPluginScope(required: { sink: WalkSink; sources: SiteBackupSources }): Promise<void> {
  const { sink, sources } = required;
  if (sink.profile === "share") {
    for (const root of [sources.agentPlugins.root, sources.agentPlugins.workspacesDir]) {
      const info = await sink.fileSystem.lstat({ file: root }).catch(err => isMissing({ err }) ? null : Promise.reject(err));
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: "Share refuses a linked plugin root." });
    }
  }
  await walkAgentPlugins(sink, sources.agentPlugins);
  await walkTree(sink, { absDir: sources.skillsDir, relDir: "skills", scope: "plugins" });
}

/** Site-local plugin packages and theme overrides travel only in a share. */
async function collectShareOnlyTrees(required: { sink: WalkSink; sources: SiteBackupSources; include: SiteBackupInclude; scopeNotes: Partial<Record<SiteBackupScope, string>> }): Promise<void> {
  const { sink, sources, include } = required;
  if (include.plugins) await walkSitePlugins(required);
  if (include.themes) await walkTree(sink, { absDir: path.join(sources.siteDir, "overrides"), relDir: "overrides", scope: "themes" });
}

/**
 * Site plugins exactly as Jini lays them out: for each folder in the install dir, the files
 * `listSitePluginPackage` names for its valid, pinned discovery record (manifest plus integrity files),
 * as `plugins/<id>/package/<path>`. Nothing else under the folder is walked, so no folder name, missing
 * manifest or fallen-forward pin can turn data/ or private memory into package content. A folder that
 * is not a valid installed plugin, or whose files fail their checks, ships nothing and is named in the
 * plugins scope note; the export carries on (the owner never has to repair a folder by hand).
 * @complexity O(install-dir entries + listed files), one read and hash per listed file.
 */
async function walkSitePlugins(required: { sink: WalkSink; sources: SiteBackupSources; scopeNotes: Partial<Record<SiteBackupScope, string>> }): Promise<void> {
  const { sink, sources } = required;
  const { installDir, records } = await sources.sitePlugins?.() ?? { installDir: path.join(sources.siteDir, "plugins"), records: [] };
  if (!(await enterShareDirectory({ sink, absDir: installDir, relDir: "plugins" }))) return;
  const leftOut: string[] = [];
  for (const { name } of await readdirOrEmpty({ dir: installDir, fileSystem: sink.fileSystem })) {
    if (name.startsWith(".")) continue; // Jini's own staging (`.drafts`) and Finder files; never a plugin.
    const record = records.find(candidate => candidate.source === "site" && candidate.id === name);
    const files = record && await sitePluginPackageFiles({ sink, installDir, record });
    if (files) sink.files.push(...files);
    else leftOut.push(name);
  }
  if (leftOut.length > 0) required.scopeNotes.plugins = `Left out because they aren't valid installed plugins (damaged manifest, version not installed, or changed files): ${leftOut.sort().map(name => "'" + name + "'").join(", ")}.`;
}

/** One plugin's planned files, each through the walk's guards, read once through no linked folder and
 *  checked against its integrity sha256, then pinned to the bytes read (the manifest too) so the ZIP
 *  carries exactly them; `null` when Jini will not list it or any listed file is missing, linked,
 *  excluded or changed. */
async function sitePluginPackageFiles(required: { sink: WalkSink; installDir: string; record: PluginDiscoveryRecord }): Promise<PlannedDiskFile[] | null> {
  const { record } = required;
  // A damaged or changed package is omitted and reported in the backup scope notes.
  const listed = await required.sink.deps.listSitePluginPackage({ installDir: required.installDir, record }).catch((error: unknown) => {
    if (!required.sink.deps.isPluginPackagePathError(error)) console.error("[site-backup] Could not inspect an installed plugin", describeErrorForLog({ err: error }));
    return null;
  });
  if (listed === null) return null;
  const staged: WalkSink = { ...required.sink, files: [], skipped: [] };
  for (const file of listed.files) {
    await addFile(staged, { root: listed.rootDir, absPath: path.join(listed.rootDir, file.relativePath), relPath: `plugins/${record.id}/package/${file.relativePath}`, scope: "plugins" });
  }
  // addFile adds nothing for a missing, excluded, linked or non-regular file, so a short list is every refusal.
  if (staged.files.length !== listed.files.length) return null;
  return pinSitePluginFiles({ files: staged.files, listed: listed.files, deps: required.sink.deps });
}

async function pinSitePluginFiles({ files, listed, deps }: { files: PlannedDiskFile[]; listed: SitePluginPackageListing["files"]; deps: SiteBackupSourceDeps }, _optional: Record<string, never> = {}): Promise<PlannedDiskFile[] | null> {
  const pinned: PlannedDiskFile[] = [];
  for (const [index, planned] of files.entries()) {
    const listedFile = listed[index];
    if (listedFile === undefined) throw new Error(`Backup source inventory has no file at index ${index}`);
    const expected = listedFile.sha256;
    const read = await readDiskFile(planned, { deps, unlinkedPath: true });
    const sha256 = read.ok ? sha256Hex({ bytes: read.bytes }) : null;
    if (sha256 === null || (expected !== null && sha256 !== expected)) return null;
    pinned.push({ ...planned, sha256 });
  }
  return pinned;
}

function sha256Hex({ bytes }: { bytes: Buffer }, _optional: Record<string, never> = {}): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type DatabaseSnapshotResult = { ok: true; bytes: Buffer; watermarkAtCapture: number } | { ok: false; message: string; logDetail?: string };

const SNAPSHOT_FAILED = "the database snapshot failed; nothing was backed up";

/**
 * A consistent copy of the whole site database, held in memory.
 *
 * Only a cheap file snapshot (SQLite) is accepted: that is the only restore mechanism whose artifact
 * is a single file this process can read back. Anything else is refused BEFORE a capture is attempted.
 * The restore-point file `captureRestorePoint` writes (beside `content.db`, or inside a fresh private
 * folder under `optional.snapshotRoot`) is deleted as soon as it is read, success or not, so a backup
 * never leaves one behind. A site export passes `snapshotRoot` so it never writes into source-site storage.
 *
 * @returns The snapshot bytes and the watermark stamped at capture, or a caller-safe `message` (a
 *   capture failure's own text stays in `logDetail`, which is for the server log only).
 * @complexity O(database size) — one full copy, one read, one unlink.
 */
export async function captureDatabaseSnapshot(input: { dbOps: DbOpsPort; scopeId: string; snapshotDirPrefix: string }, optional: { maxBytes?: number; snapshotRoot?: string } = {}): Promise<DatabaseSnapshotResult> {
  const { restorePoint } = await input.dbOps.getCapabilities();
  if (restorePoint.costClass !== "cheap" || restorePoint.kind !== "file-snapshot") {
    return {
      ok: false,
      message: `this site's database cannot be snapshotted into a backup file: only SQLite sites are supported (this database reports a '${restorePoint.kind}' restore mechanism)`,
    };
  }
  if (optional.snapshotRoot === undefined) return readRestorePoint(input, optional);
  let directory: string;
  try {
    directory = await mkdtemp(path.join(optional.snapshotRoot, input.snapshotDirPrefix));
  } catch (err) {
    return { ok: false, message: SNAPSHOT_FAILED, logDetail: describeErrorForLog({ err }) };
  }
  try {
    return await readRestorePoint(input, { ...optional, directory });
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) => console.error("[site-backup] Could not remove the snapshot directory", describeErrorForLog({ err: error })));
  }
}

/** Captures one restore point (into `directory` when given), reads it back and unlinks it. */
async function readRestorePoint(input: { dbOps: DbOpsPort; scopeId: string }, optional: { maxBytes?: number; directory?: string }): Promise<DatabaseSnapshotResult> {
  let artifactRef: string;
  let watermarkAtCapture: number;
  try {
    const scope = { scopeId: input.scopeId };
    ({ artifactRef, watermarkAtCapture } = await (optional.directory === undefined ? input.dbOps.captureRestorePoint(scope) : input.dbOps.captureRestorePoint(scope, { directory: optional.directory })));
  } catch (err) {
    return { ok: false, message: SNAPSHOT_FAILED, logDetail: describeErrorForLog({ err }) };
  }
  try {
    if (optional.maxBytes !== undefined && (await stat(artifactRef)).size > optional.maxBytes) return { ok: false, message: "Database snapshot exceeds the 300 MiB share cap." };
    return { ok: true, bytes: await readFile(artifactRef), watermarkAtCapture };
  } catch (err) {
    return { ok: false, message: "the database snapshot could not be read back; nothing was backed up", logDetail: describeErrorForLog({ err }) };
  } finally {
    await unlink(artifactRef).catch((error: unknown) => {
      // An already removed snapshot needs no further cleanup.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) console.error("[site-backup] Could not remove the snapshot", describeErrorForLog({ err: error }));
    });
  }
}

/** One decimal place, dropped when it is `.0` (`100 MiB`, not `100.0 MiB`). */
function oneDecimal({ value }: { value: number }, _optional: Record<string, never> = {}): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** `123 B`, `4.2 KiB`, `12.5 MiB`, `1 GiB` — for messages and the confirmation dialog. */
export function formatByteSize({ bytes }: { bytes: number }, _optional: Record<string, never> = {}): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${oneDecimal({ value: bytes / 1024 })} KiB`;
  if (bytes < 1024 * MIB) return `${oneDecimal({ value: bytes / MIB })} MiB`;
  return `${oneDecimal({ value: bytes / (1024 * MIB) })} GiB`;
}

/**
 * Leaves out every disk file over the host's per-file limit, each named in `skipped` with its size,
 * so one huge video does not cost the whole backup (2026-10-06: the owner asked for a full backup
 * that just works). The database is not a disk file here: an oversized snapshot still fails the plan
 * in {@link checkSiteBackupLimits}, because a backup without its database is not a backup.
 *
 * @complexity O(n).
 */
export function skipOversizedFiles({ files, host }: { files: readonly PlannedDiskFile[]; host: SiteBackupHostLimit }, _optional: Record<string, never> = {}): { files: PlannedDiskFile[]; skipped: SkippedSiteBackupFile[] } {
  const maxFileBytes = host.maxFileBytes;
  if (maxFileBytes === undefined) return { files: [...files], skipped: [] };
  const skipped = files
    .filter((file) => file.bytes > maxFileBytes)
    .map((file) => ({ path: file.path, reason: `${formatByteSize({ bytes: file.bytes })}, over ${host.label}'s ${formatByteSize({ bytes: maxFileBytes })} per-file limit` }));
  return { files: files.filter((file) => file.bytes <= maxFileBytes), skipped };
}

export type SiteBackupLimitsResult = { ok: true; totalBytes: number } | { ok: false; message: string };

/**
 * Checks a backup against `limits` (the host's own caps) and the host's own per-file limit (when its
 * plugin declares one) before anything is uploaded. A file over the per-file limit is refused, never truncated or split — and EVERY such file is named, so one retry
 * after removing them is enough. The plan runs {@link skipOversizedFiles} over the disk files first,
 * so in practice only an oversized database snapshot reaches this refusal.
 *
 * @complexity O(n) in the file count.
 */
export function checkSiteBackupLimits({ files, host, limits }: { files: readonly { path: string; bytes: number }[]; host: SiteBackupHostLimit; limits: SiteBackupLimits }, _optional: Record<string, never> = {}): SiteBackupLimitsResult {
  const maxFileBytes = host.maxFileBytes;
  const oversized = maxFileBytes === undefined ? [] : files.filter((file) => file.bytes > maxFileBytes);
  if (maxFileBytes !== undefined && oversized.length > 0) {
    // The exact byte count too: a file 1 byte over rounds to the limit's own size.
    const named = oversized.map((file) => `${file.path} (${formatByteSize({ bytes: file.bytes })}, ${file.bytes} bytes)`).join(", ");
    return {
      ok: false,
      message: `${oversized.length} file(s) exceed ${host.label}'s ${formatByteSize({ bytes: maxFileBytes })} per-file limit and cannot be backed up: ${named}. Nothing is truncated or split; remove or shrink these, or turn off the scope that holds them.`,
    };
  }
  if (files.length > limits.maxFiles) {
    return { ok: false, message: `the backup has ${files.length} files, over the ${limits.maxFiles}-file cap. Turn off a scope (media usually holds the most files) and plan again.` };
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > limits.maxTotalBytes) {
    return { ok: false, message: `the backup totals ${formatByteSize({ bytes: totalBytes })}, over the ${formatByteSize({ bytes: limits.maxTotalBytes })} cap. Turn off a scope (media usually holds the most bytes) and plan again.` };
  }
  return { ok: true, totalBytes };
}

export type ReadPlannedFileResult = { ok: true; bytes: Buffer } | { ok: false; message: string };

/** The generic descriptor contract belongs to Jini; backup retains its existing test seam. */
export type SiteBackupReadHandle = ReviewedFileHandle;
type ReadPlannedFileOptions = { fileSystem?: ReviewedFileSystem; openFile?: ReviewedFileSystem["open"] };
type ReadDiskFileOptions = ReadPlannedFileOptions & { deps: Pick<SiteBackupSourceDeps, "readReviewedFile">; unlinkedPath?: boolean };

/**
 * Reads a planned file at push time, refusing it if it is no longer the file the human reviewed.
 *
 * Opened with `O_NOFOLLOW` and checked through the SAME handle it is read from, so a file swapped
 * for a symlink after the plan cannot be followed, and the size/mtime compared are the bytes
 * actually read. A file planned with a `sha256` must also still be reached through no linked folder
 * and hash to exactly that digest.
 *
 * @complexity O(file size + path depth) — Jini proves identity and plain ancestry; pinned files add a hash.
 */
export async function readPlannedFile(file: PlannedDiskFile, optional: ReadDiskFileOptions): Promise<ReadPlannedFileResult> {
  const read = await readDiskFile(file, { ...optional, unlinkedPath: file.sha256 !== undefined });
  return read.ok && file.sha256 !== undefined && sha256Hex({ bytes: read.bytes }) !== file.sha256 ? staleResult(file) : read;
}

function staleResult(file: PlannedDiskFile): ReadPlannedFileResult {
  return { ok: false, message: `'${file.path}' changed since the plan was made. Call site_backup_plan again.` };
}

/** The one disk read behind planning checks and push: `unlinkedPath` also refuses an `absPath` whose
 *  realpath differs, i.e. one reached through a linked folder (`O_NOFOLLOW` guards only the last name). */
async function readDiskFile(file: PlannedDiskFile, optional: ReadDiskFileOptions): Promise<ReadPlannedFileResult> {
  // Preserve the stricter absolute-path check for pinned package/theme bytes.
  if (optional.unlinkedPath && (await realpath(file.absPath).catch((error: unknown) => {
    // Removed paths and broken links are an ordinary stale-plan refusal.
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP"))) console.error("[site-backup] Could not resolve the planned file", describeErrorForLog({ err: error }));
    return null;
  })) !== file.absPath) return staleResult(file);
  const fileSystem = optional.fileSystem ?? (optional.openFile ? {
    open: optional.openFile, lstat: (file: string) => lstat(file, { bigint: true }), realpath,
  } : undefined);
  const bytes = await optional.deps.readReviewedFile({ file }, { fileSystem });
  return bytes === null ? staleResult(file) : { ok: true, bytes };
}

/** How the host names itself in the manifest: the `format` string and the key its version sits under. */
export interface SiteBackupManifestIdentity {
  readonly format: string;
  readonly producerKey: string;
}

export interface SiteBackupManifestInput {
  readonly createdAt: string;
  /** The producing host's own version string. */
  readonly hostVersion: string;
  readonly schema: { readonly index: number; readonly tag: string };
  readonly site: { readonly name: string; readonly folderName: string };
  /** `null` when the database scope is off. */
  readonly database: { readonly watermarkAtCapture: number } | null;
  readonly include: SiteBackupInclude;
  readonly scopeNotes: Partial<Record<SiteBackupScope, string>>;
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
}

/**
 * The backup's manifest file: what produced it (the host's version, migration schema), when, which
 * scopes it holds and why any is incomplete, and every file with its sha256 — what a future restore
 * checks before touching anything.
 *
 * @complexity O(n) in the file count.
 */
export function buildSiteBackupManifest(input: SiteBackupManifestInput, identity: SiteBackupManifestIdentity): string {
  const scopes = Object.fromEntries(
    SITE_BACKUP_SCOPES.map((scope) => {
      const note = input.scopeNotes[scope];
      return [scope, { included: input.include[scope], ...(note !== undefined ? { note } : {}) }];
    })
  );
  const manifest = {
    format: identity.format,
    formatVersion: 1,
    createdAt: input.createdAt,
    [identity.producerKey]: { version: input.hostVersion },
    schema: { index: input.schema.index, tag: input.schema.tag },
    site: { name: input.site.name, folderName: input.site.folderName },
    database: input.database === null ? null : { path: SITE_BACKUP_DATABASE_PATH, engine: "sqlite", watermarkAtCapture: input.database.watermarkAtCapture },
    scopes,
    files: input.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
