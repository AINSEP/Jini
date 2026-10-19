import { readPluginIdentity, assertPluginIdentityAvailable } from "@jini-ai/core/plugin-directory";
/** Local-install environment consent is host-owned; archiveReader owns zip-slip/decompression
 * checks and tierPolicy.checkInstall owns publisher admission. */
/** Site plugin folder installer governed by plugin-install-plan.md, M1a.
 * Installation inspects JSON and bytes only: importing code belongs exclusively to enable.
 * Staging is a sibling of discovery's root, on the same filesystem, so partial copies never list.
 */
import { constants, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, realpath, readdir, readFile, open, mkdir, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as semver from "semver";
import { validateManifest, validatePluginIdFormat, type PluginManifest, type PluginTier } from "../manifest.js";
import type { ArchiveReaderPort, ManifestHostPorts, PluginTierPolicy } from "../ports.js";
import type { PluginActivationRepoPort } from "../activation.js";
import type { PluginConflict } from "../plugin-claims.js";
import { PLUGIN_MANIFEST_FILENAME as MANIFEST, PLUGIN_MANIFEST_FILENAMES, canonicalizePluginManifest } from "../plugin-format.js";

export class PluginInstallError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PluginInstallError"; }
}
export interface PluginInstallPreview {
  readonly warnings?: readonly string[];
  readonly publisherId?: string;
  readonly provides?: readonly string[];
  readonly keywords?: readonly string[];
  id: string; name: string; version: string; tier: PluginTier;
  capabilities: readonly string[]; hooks: readonly string[];
  /** `false` only for a tier-1 (manifest-only) package — the runtime never imports anything for it. */
  hasCode: boolean; digest: string; upgradeFrom?: string;
  /** Content-type keys the manifest declares (AW-7 Tier 1); created when the plugin is turned on. */
  contentTypes: readonly string[];
  /** What turning it on would clash with — see {@link PluginInstallDeps.conflicts}. Informational
   *  only: not part of the consent digest, and enable re-checks (the enable-time conflict gate). */
  conflicts: readonly PluginConflict[];
}
export type PluginInstallInput = ({ sourceDir: string; archive?: never } | { archive: Uint8Array; sourceDir?: never }) & { replace?: boolean };
export interface PluginInstallDeps extends ManifestHostPorts {
  /** Internal authoring path only: append immutable versions while retaining rollback bytes.
   * Same-version replacement still refuses enabled plugins. Ordinary installs keep their policy. */
  readonly versionAppend?: boolean;
  readonly warn?: (message: string) => void;
  readonly archiveReader: ArchiveReaderPort;
  readonly tierPolicy: PluginTierPolicy;
  installDir: string; builtInIds: readonly string[];
  /** Built-in publisher reservations, independent of their local storage ids. Hosts supplying
   * only builtInIds must wrap publication in their cross-family identity-admission transaction;
   * publisher identities cannot be inferred from a local name or extension namespace. */
  readonly builtInManifests?: readonly PluginManifest[];
  /** Installed-neighbour reads only; extraction and publication retain their native effects. */
  readonly identityFilesystem?: Pick<typeof import('node:fs/promises'), 'lstat' | 'readdir' | 'readFile'>;
  repo: Pick<PluginActivationRepoPort, "listAll">;
  /** Names the staged manifest would take that core or an enabled plugin already holds. Install is
   *  site-wide but activation is per workspace: the admin root answers for the workspace it serves
   *  (`composePluginRuntime`); the CLI, which names no workspace, answers none. */
  conflicts: (required: { manifest: PluginManifest }, optional?: Record<string, never>) => Promise<readonly PluginConflict[]>;
}
export interface PluginInstallerPort {
  preview(required: PluginInstallInput, optional?: PluginInstallOptions): Promise<PluginInstallPreview>;
  install(required: PluginInstallInput & { expectedDigest: string }, optional?: PluginInstallOptions): Promise<PluginInstallPreview>;
}
/** Not a model input: the source authoring service opts into immutable version publication. */
export interface PluginInstallOptions { readonly versionAppend?: boolean }
export interface PluginSnapshotLimits { readonly maxEntries?: number; readonly maxFileBytes?: number; readonly maxTotalBytes?: number }
/** Retained bytes plus the entry count, including empty directories, for authoring preflight. */
export interface PluginPackageSnapshot extends Map<string, Buffer> { readonly entryCount: number }
const MAX_ENTRIES = 4096;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const hash = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
function fail(code: string, message: string): never { throw new PluginInstallError(code, message); }
const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);
function assertRealDirectory(info: Stats, message: string): void {
  if (!info.isDirectory() || info.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", message);
}
async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
/** Activation callbacks share this guard; the activation service compensates a rejected enable. */
export async function assertPluginInstallIdle(required: { installDir: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (await exists(path.resolve(required.installDir) + "-install-lock")) fail("PLUGIN_INSTALL_BUSY", "Another install is in progress.");
}

/** Snapshot limits capped at the installer ceilings; a caller may only tighten them. */
function snapshotLimits(limits: PluginSnapshotLimits): Required<PluginSnapshotLimits> {
  for (const limit of Object.values(limits)) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) fail('PLUGIN_SNAPSHOT_LIMIT_INVALID', 'Snapshot limits must be positive safe integers.');
  }
  return {
    maxEntries: Math.min(limits.maxEntries ?? MAX_ENTRIES, MAX_ENTRIES),
    maxFileBytes: Math.min(limits.maxFileBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES),
    maxTotalBytes: Math.min(limits.maxTotalBytes ?? MAX_TOTAL_BYTES, MAX_TOTAL_BYTES),
  };
}

/** Reads up to `size` bytes; the caller sizes the buffer one past the stat()'d length. */
async function readUpTo(handle: FileHandle, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size);
  let length = 0;
  while (length < buffer.length) {
    const read = await handle.read(buffer, length, buffer.length - length, null);
    if (read.bytesRead === 0) break;
    length += read.bytesRead;
  }
  return buffer.subarray(0, length);
}

function assertRetainableFile(info: Stats, maxFileBytes: number, remainingBytes: number): void {
  if (!info.isFile() || info.nlink !== 1) fail("PLUGIN_PACKAGE_UNSAFE", "Only regular files without hard links are allowed.");
  if (info.size > maxFileBytes || info.size > remainingBytes) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package exceeds the file or total size limit.");
}

/** One regular, unlinked file's bytes within the limits, refused if it is swapped, grows or shrinks while being read. */
async function readStableFile(required: { target: string; info: Stats; maxFileBytes: number; remainingBytes: number }): Promise<Buffer> {
  const { info, maxFileBytes, remainingBytes } = required;
  assertRetainableFile(info, maxFileBytes, remainingBytes);
  const handle = await open(required.target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.nlink !== 1 || current.ino !== info.ino || current.dev !== info.dev) fail("PLUGIN_PACKAGE_UNSAFE", "Package changed while reading.");
    // A bounded read also protects against a file growing after stat().
    const bytes = await readUpTo(handle, info.size + 1);
    if (bytes.length > maxFileBytes || bytes.length > remainingBytes) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package grew past its size limit.");
    if (bytes.length > info.size || (await handle.stat()).size !== bytes.length) fail("PLUGIN_PACKAGE_UNSAFE", "Package changed while reading.");
    return Buffer.from(bytes);
  } finally { await handle.close(); }
}

/** Retain the inspected bytes, rather than copying a mutable source after consent verification. */
async function snapshot(sourceDir: string, limits: PluginSnapshotLimits = {}): Promise<PluginPackageSnapshot> {
  const { maxEntries, maxFileBytes, maxTotalBytes } = snapshotLimits(limits);
  const files = new Map<string, Buffer>();
  let entries = 0; let total = 0;
  async function walk(dir: string, prefix: string): Promise<void> {
    assertRealDirectory(await lstat(dir), "Package directories must not be symbolic links.");
    for (const name of (await readdir(dir)).sort()) {
      if (++entries > maxEntries) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package has too many entries.");
      const target = path.join(dir, name); const relative = prefix + name;
      const info = await lstat(target);
      if (info.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Symbolic links are not allowed.");
      if (info.isDirectory()) { await walk(target, relative + "/"); continue; }
      const bytes = await readStableFile({ target, info, maxFileBytes, remainingBytes: maxTotalBytes - total });
      total += bytes.length; files.set(relative, bytes);
    }
  }
  await walk(sourceDir, ""); return Object.assign(files, { entryCount: entries });
}

/** Files a manifest-only package may carry: documentation, data and images — nothing a browser or
 *  Node would execute. An allowlist, so a new script-like extension is refused by default (SVG is
 *  left out on purpose: it can carry script). */
const DECLARATIVE_DATA_FILE = /(?:^|\/)(?:LICENSE|[^/]+\.(?:json|md|txt|png|jpe?g|gif|webp))$/;

/**
 * Tier rules for a sideloaded package. Tier-1 (AW-7, 2026-10-04) is the manifest-only tier ADR-024
 * §1 defines — "zero executable code", so it is safe from any publisher: it may not ship a single
 * code file (its declarations — no code surface, parseable `contentTypes` — are already checked by
 * `validateManifest`). Anything else must
 * still be tier-3 with `server/index.mjs`, because a sideloaded manifest cannot grant itself a
 * verified publisher tier (tier-2 needs the sandbox, which does not exist yet).
 */
function checkTierAndCode(candidate: PluginManifest, files: Map<string, Buffer>, tierPolicy: PluginTierPolicy): void {
  if (candidate.tier === "tier-1") {
    const code = [...files.keys()].filter((key) => !PLUGIN_MANIFEST_FILENAMES.includes(key) && !DECLARATIVE_DATA_FILE.test(key)); // legacy alias
    if (code.length) fail("PLUGIN_MANIFEST_INVALID", `A declarative (tier-1) plugin must not ship code: ${code.join(", ")}`);
    return;
  }
  if (!files.has("server/index.mjs")) fail("PLUGIN_MANIFEST_INVALID", "server/index.mjs is required.");
  tierPolicy.checkInstall({ manifest: candidate, files });
}

/** The parsed manifest JSON (current name first, then the legacy alias), or a refusal. */
function parseManifestFile(files: Map<string, Buffer>): unknown {
  const filename = PLUGIN_MANIFEST_FILENAMES.find(name => files.has(name)); // legacy alias
  try { return JSON.parse(filename === undefined ? "" : files.get(filename)!.toString("utf8")); }
  catch { return fail("PLUGIN_MANIFEST_INVALID", `A valid ${MANIFEST} is required.`); }
}

/** Integrity must list exactly every packaged file except plugin manifests, each hash matching. */
function assertIntegrity(candidate: PluginManifest, files: Map<string, Buffer>): void {
  if (!candidate.integrity || typeof candidate.integrity !== "object" || Array.isArray(candidate.integrity)) fail("PLUGIN_INTEGRITY_INVALID", "An integrity map is required.");
  const packaged = [...files.keys()].filter((key) => !PLUGIN_MANIFEST_FILENAMES.includes(key)).sort(); // legacy alias
  if (JSON.stringify(Object.keys(candidate.integrity).sort()) !== JSON.stringify(packaged)) fail("PLUGIN_INTEGRITY_INVALID", "Integrity must list exactly every file except plugin manifests.");
  for (const key of packaged) if (candidate.integrity[key] !== hash(files.get(key)!)) fail("PLUGIN_INTEGRITY_INVALID", `Integrity mismatch: ${key}`);
}

// validateManifest owns the id grammar; only the version needs extra path-safety checks.
function assertPathSafeVersion(candidate: PluginManifest | null): asserts candidate is PluginManifest {
  if (!candidate || typeof candidate.version !== "string" || !semver.valid(candidate.version) || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(candidate.version)) fail("PLUGIN_MANIFEST_INVALID", "Package manifest, id or version is invalid.");
}

function validatePackage(files: Map<string, Buffer>, deps: PluginInstallDeps): PluginManifest {
  const { builtInIds } = deps;
  const raw = parseManifestFile(files);
  const candidate = raw as PluginManifest | null;
  const id = typeof candidate?.id === "string" ? candidate.id : "";
  if (builtInIds.some((builtin) => builtin.toLowerCase() === id.toLowerCase())) fail("PLUGIN_SHADOWS_BUILT_IN", "Package id belongs to a built-in plugin.");
  const result = validateManifest({ ...deps, manifest: raw, folderName: id, builtInIds });
  // The manifest's own messages, so a refused declaration says what is wrong with it.
  if (result.errors.length) fail("PLUGIN_MANIFEST_INVALID", result.errors.map((error) => error.message).join("; "));
  assertPathSafeVersion(candidate);
  checkTierAndCode(candidate, files, deps.tierPolicy);
  if (typeof candidate.name !== "string" || !candidate.name.trim() || typeof candidate.sdkRange !== "string" || !semver.validRange(candidate.sdkRange)) fail("PLUGIN_MANIFEST_INVALID", "A name and valid SDK range are required.");
  assertIntegrity(candidate, files);
  return candidate;
}

type IdentityScan = Pick<typeof import('node:fs/promises'), 'lstat' | 'readdir' | 'readFile'>;
type InstalledIdentity = ReturnType<typeof readPluginIdentity>;

function identityOf(manifest: PluginManifest, deps: PluginInstallDeps, name = manifest.id): InstalledIdentity {
  return readPluginIdentity({ manifest: manifest as unknown as Readonly<Record<string, unknown>>, name, namespace: deps.identityNamespace });
}

function assertIdentityFree(candidate: InstalledIdentity & { family: string; localId: string }, installed: Parameters<typeof assertPluginIdentityAvailable>[0]['installed']): void {
  try { assertPluginIdentityAvailable({ candidate, installed }); }
  catch { fail("PLUGIN_ID_CONFLICT", "The publisher-qualified plugin id conflicts with an installed package."); }
}

function warnUnavailableSlot(deps: PluginInstallDeps, localId: string, error: unknown): void {
  if (!['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  // A disappearing/unreadable neighbour is isolated; link refusals and other I/O faults remain fatal.
  (deps.warn ?? console.warn)(`Plugin '${localId}': installed slot is unavailable; omitted from identity admission.`);
}

/** Version names in one installed slot, or none when the slot is not a folder or is unavailable. */
async function scanSlotVersions(required: { scan: IdentityScan; slot: string; localId: string; deps: PluginInstallDeps }): Promise<string[]> {
  const { scan, slot } = required;
  try {
    const info = await scan.lstat(slot);
    if (info.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Installed plugin directory must not be a link.");
    return info.isDirectory() ? await scan.readdir(slot) : [];
  } catch (error) { warnUnavailableSlot(required.deps, required.localId, error); return []; }
}

async function isScannableVersion(required: { scan: IdentityScan; versionDir: string; localId: string; deps: PluginInstallDeps }): Promise<boolean> {
  try {
    const versionInfo = await required.scan.lstat(required.versionDir);
    if (versionInfo.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Installed plugin version must not be a link.");
    return versionInfo.isDirectory();
  } catch (error) { warnUnavailableSlot(required.deps, required.localId, error); return false; }
}

async function findInstalledManifest(scan: IdentityScan, versionDir: string): Promise<string> {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) { // legacy alias
    const candidatePath = path.join(versionDir, filename);
    try { await scan.lstat(candidatePath); return candidatePath; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return path.join(versionDir, MANIFEST);
}

/** The installed version's identity, or undefined (with a warning) when its manifest is unreadable. */
async function readInstalledIdentity(required: { scan: IdentityScan; versionDir: string; localId: string; deps: PluginInstallDeps }): Promise<InstalledIdentity | undefined> {
  const { scan, localId, deps } = required;
  try {
    const manifestPath = await findInstalledManifest(scan, required.versionDir);
    const manifestInfo = await scan.lstat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Installed plugin manifests must not be links.");
    const installedManifest = JSON.parse(await scan.readFile(manifestPath, "utf8"));
    return readPluginIdentity({ manifest: installedManifest, name: localId, namespace: deps.identityNamespace });
  } catch (error) {
    if (error instanceof PluginInstallError) throw error;
    // Preserve link refusals while isolating one broken unrelated manifest.
    (deps.warn ?? console.warn)(`Plugin '${localId}': installed identity manifest is unreadable or invalid; omitted from identity admission.`);
    return undefined;
  }
}

/** Every installed version of one neighbour slot must not already hold the candidate's identity. */
async function assertSlotIdentityFree(required: { scan: IdentityScan; root: string; localId: string; candidate: InstalledIdentity & { family: string; localId: string }; deps: PluginInstallDeps }): Promise<void> {
  const { scan, localId, deps } = required;
  const slot = path.join(required.root, localId);
  for (const version of await scanSlotVersions({ scan, slot, localId, deps })) {
    if (!semver.valid(version)) continue;
    const versionDir = path.join(slot, version);
    if (!(await isScannableVersion({ scan, versionDir, localId, deps }))) continue;
    const installed = await readInstalledIdentity({ scan, versionDir, localId, deps });
    if (installed) assertIdentityFree(required.candidate, [{ ...installed, family: "site-runtime", localId, version, enabled: false }]);
  }
}

/** Version folder names in an installed slot, dotfiles excluded; any non-semver name is refused. */
async function readInstalledVersions(slot: string): Promise<string[]> {
  const versions = (await readdir(slot)).filter(name => !name.startsWith('.'));
  if (versions.some(version => !semver.valid(version))) fail('PLUGIN_ID_CONFLICT', 'Existing plugin has an unrecognized version folder.');
  return versions;
}

/** Case aliases, Trash entries and enabled plugins block the slot before its versions are compared. */
async function assertSlotAvailable(required: { manifest: PluginManifest; entries: readonly string[]; root: string; deps: PluginInstallDeps }): Promise<void> {
  const { manifest, root, deps } = required;
  const id = manifest.id.toLowerCase();
  if (required.entries.some((name) => name.toLowerCase() === id && name !== manifest.id)) fail("PLUGIN_ID_CONFLICT", "A plugin id differs only by letter case.");
  if (await exists(path.join(path.dirname(root), path.basename(root) + "-trash", manifest.id))) fail("PLUGIN_IN_TRASH", "Restore or delete this plugin in Trash first.");
  const versionExists = await exists(path.join(root, manifest.id, manifest.version));
  if ((!deps.versionAppend || versionExists) && (await deps.repo.listAll()).some((row) => row.pluginId.toLowerCase() === id && row.enabled)) fail("PLUGIN_ENABLED", "Turn the plugin off in every workspace first.");
}

/** The latest installed version this package upgrades from; downgrades and silent re-installs are refused. */
async function latestInstalledVersion(required: { manifest: PluginManifest; input: PluginInstallInput; slot: string; deps: PluginInstallDeps }): Promise<string | undefined> {
  const { manifest, slot, deps } = required;
  if (!(await exists(slot))) return undefined;
  assertRealDirectory(await lstat(slot), "Installed plugin directory must not be a link.");
  const versions = await readInstalledVersions(slot);
  const latest = versions.sort(semver.rcompare)[0];
  if (latest && semver.lt(manifest.version, latest)) fail("PLUGIN_DOWNGRADE", "Installing an older version is not allowed.");
  if (versions.some((version) => semver.eq(version, manifest.version)) && (deps.versionAppend || !required.input.replace)) fail("PLUGIN_VERSION_EXISTS", deps.versionAppend ? "Version append requires a new version; installed bytes are immutable." : "This version exists. Choose replace explicitly.");
  return latest;
}

async function checkDestination(manifest: PluginManifest, input: PluginInstallInput, deps: PluginInstallDeps): Promise<string | undefined> {
  const root = path.resolve(deps.installDir);
  const scan = deps.identityFilesystem ?? { lstat, readdir, readFile };
  const entries = await scan.readdir(root).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
  const candidate = { ...identityOf(manifest, deps), family: "site-runtime", localId: manifest.id };
  assertIdentityFree(candidate, (deps.builtInManifests ?? []).map(builtIn => ({
    ...identityOf(builtIn, deps), family: "site-runtime", localId: builtIn.id, version: builtIn.version, enabled: false,
  })));
  for (const localId of entries) await assertSlotIdentityFree({ scan, root, localId, candidate, deps });
  await assertSlotAvailable({ manifest, entries, root, deps });
  return latestInstalledVersion({ manifest, input, slot: path.join(root, manifest.id), deps });
}

/** Retire obsolete immutable source releases after a successful controlled reload.
 * All workspace active pointers survive, plus the newest three versions for rollback.
 * Uses the installer's publication lock so pruning cannot overlap a package install.
 * @returns Retired version names; dotfiles are unrelated metadata and remain untouched.
 * @throws PluginInstallError for unsafe paths, invalid version slots or an active install.
 * @complexity O(V log V + A) for V installed versions and A activation rows, then one removal per retired version.
 */
export async function pruneSitePluginVersions(required: {
  id: string; installDir: string; repo: Pick<PluginActivationRepoPort, 'listAll'>;
}, _optional: Record<string, never> = {}): Promise<readonly string[]> {
  if (validatePluginIdFormat({ id: required.id }).length) fail('PLUGIN_PACKAGE_UNSAFE', 'Invalid plugin id.');
  const root = path.resolve(required.installDir);
  const slot = path.join(root, required.id);
  for (const target of [root, slot]) assertRealDirectory(await lstat(target), 'Installed plugin directory must not be a link.');
  return withPluginInstallLock({ root, run: async () => {
    const versions = await readInstalledVersions(slot);
    const retained = new Set(versions.sort(semver.rcompare).slice(0, 3));
    for (const row of await required.repo.listAll()) if (row.pluginId === required.id && row.enabled) retained.add(row.version);
    const retired = versions.filter(version => !retained.has(version));
    for (const version of retired) await rm(path.join(slot, version), { recursive: true, force: true });
    return retired;
  } });
}

async function inspect(input: PluginInstallInput, deps: PluginInstallDeps) {
  const files = input.archive !== undefined ? new Map([...await deps.archiveReader({ archive: input.archive })].map(([key, bytes]) => [key, Buffer.from(bytes)])) : await inspectFolder(input.sourceDir!, deps);
  const manifest = validatePackage(files, deps);
  const upgradeFrom = await checkDestination(manifest, input, deps);
  // Include manifest bytes: changed capabilities/name/version must invalidate human consent too.
  const digest = digestSitePluginSnapshot({ files });
  const identity = identityOf(manifest, deps);
  const preview: PluginInstallPreview = { warnings: identity.warnings, publisherId: identity.id, provides: identity.provides, keywords: identity.keywords, id: manifest.id, name: manifest.name, version: manifest.version, tier: manifest.tier, capabilities: manifest.capabilities, hooks: manifest.hooks, hasCode: manifest.tier !== "tier-1", contentTypes: deps.declarativeContentTypes.parse({ value: manifest.contentTypes }).decls.map((decl) => decl.key), conflicts: await deps.conflicts({ manifest }), digest, ...(upgradeFrom ? { upgradeFrom } : {}) };
  return { files, manifest, preview };
}

async function inspectFolder(source: string, deps: PluginInstallDeps) {
  const sourceDir = await realpath(source).catch(() => fail("PLUGIN_SOURCE_INVALID", "Source folder was not found."));
  if ((await lstat(source)).isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Source folder must not be a link.");
  // Canonicalize existing ancestors too: lexical checks alone miss symlink aliases.
  async function canonical(target: string): Promise<string> {
    try { return await realpath(target); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return path.join(await canonical(path.dirname(target)), path.basename(target));
    }
  }
  const root = await canonical(path.resolve(deps.installDir));
  for (const destination of [root, root + "-staging", root + "-trash"]) {
    if (inside(destination, sourceDir) || inside(sourceDir, destination)) fail("PLUGIN_SOURCE_INVALID", "Source must be separate from installed, staging and Trash folders.");
  }
  return snapshot(sourceDir);
}

/** Loader uses the same bounded, link-free byte snapshot, then verifies the retained bytes. */
export async function snapshotSitePluginPackage(required: { sourceDir: string }, optional: PluginSnapshotLimits = {}): Promise<PluginPackageSnapshot> {
  return snapshot(required.sourceDir, optional);
}

/** The installer's consent digest, also used to bind site-authored provenance to exact bytes.
 * @returns A SHA-256 digest covering the manifest and every retained file.
 */
export function digestSitePluginSnapshot(required: { files: ReadonlyMap<string, Buffer> }, _optional = {}): string {
  return hash(Buffer.from(JSON.stringify([...required.files].map(([key, bytes]) => [key, hash(bytes)]).sort(([a], [b]) => a! < b! ? -1 : 1))));
}

export async function computePluginIntegrity(required: { sourceDir: string }, _optional: Record<string, never> = {}): Promise<Record<string, string>> {
  return Object.fromEntries([...await snapshot(required.sourceDir)].filter(([key]) => !PLUGIN_MANIFEST_FILENAMES.includes(key)).map(([key, bytes]) => [key, hash(bytes)])); // legacy alias
}
export async function previewSitePluginInstall(required: PluginInstallInput & { deps: PluginInstallDeps }, _optional: Record<string, never> = {}): Promise<PluginInstallPreview> {
  return (await inspect(required, required.deps)).preview;
}

/** Directory lock is also cross-process: CLI and admin cannot replace the same site concurrently. */
async function withPluginInstallLock<T>(required: { root: string; run: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  const lock = required.root + '-install-lock';
  await mkdir(path.dirname(required.root), { recursive: true });
  try { await mkdir(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('PLUGIN_INSTALL_BUSY', 'Another install is in progress.'); throw error; }
  try { return await required.run(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

/** Writes the retained bytes (manifest canonicalized) into a fresh staged version folder. */
async function writeStagedVersion(required: { versionDir: string; files: Map<string, Buffer> }): Promise<void> {
  for (const [key, bytes] of canonicalizePluginManifest({ files: required.files })) { // legacy alias
    const target = path.join(required.versionDir, key);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
  }
}

/** Swaps the staged version in; on failure the replaced copy is put back before rethrowing. */
async function swapVersion(required: { versionDir: string; liveVersion: string; backup: string }): Promise<void> {
  const { versionDir, liveVersion, backup } = required;
  const replaced = await exists(liveVersion);
  if (replaced) await rename(liveVersion, backup);
  try { await rename(versionDir, liveVersion); }
  catch (error) {
    if (replaced) await rename(backup, liveVersion).catch(() => fail("PLUGIN_INSTALL_RECOVERY_REQUIRED", `Restore the previous version from ${backup} before retrying.`));
    throw error;
  }
}

/** Publishes the staged slot: a first install renames the whole slot, an upgrade swaps one version. */
async function publishStaged(required: { live: string; staging: string; manifest: PluginManifest; versionAppend?: boolean | undefined }): Promise<void> {
  const { live, staging, manifest } = required;
  const stagedSlot = path.join(staging, "new");
  if (!(await exists(live))) { await rename(stagedSlot, live); return; }
  await swapVersion({ versionDir: path.join(stagedSlot, manifest.version), liveVersion: path.join(live, manifest.version), backup: path.join(staging, "old") });
  // Publish first, retire old versions second: discovery always sees a complete upgrade.
  if (required.versionAppend) return;
  for (const version of await readdir(live)) {
    if (version !== manifest.version) await rm(path.join(live, version), { recursive: true, force: true });
  }
}

/** Publication and retention use the same installer-owned cross-process lock. */
export async function installSitePlugin(required: PluginInstallInput & { expectedDigest: string; deps: PluginInstallDeps }, _optional: Record<string, never> = {}): Promise<PluginInstallPreview> {
  const optional = required.deps;
  const root = path.resolve(optional.installDir);
  const { files, manifest, preview } = await inspect(required, optional);
  if (preview.digest !== required.expectedDigest) fail("PLUGIN_CHANGED_SINCE_PREVIEW", "Package changed since preview. Review it again.");
  for (const target of [root, root + "-staging", root + "-trash"]) {
    if (await exists(target)) assertRealDirectory(await lstat(target), "Install, staging and Trash roots must be real directories.");
  }
  return withPluginInstallLock({ root, run: async () => {
    let staging: string | undefined;
    try {
      await mkdir(root + "-staging", { recursive: true });
      staging = await mkdtemp(path.join(root + "-staging", "install-"));
      await writeStagedVersion({ versionDir: path.join(staging, "new", manifest.version), files });
      await checkDestination(manifest, required, optional);
      await mkdir(root, { recursive: true });
      await publishStaged({ live: path.join(root, manifest.id), staging, manifest, versionAppend: optional.versionAppend }).catch((error: unknown) => {
        // Never let cleanup erase the sole remaining copy when rollback itself fails.
        if (error instanceof PluginInstallError && error.code === "PLUGIN_INSTALL_RECOVERY_REQUIRED") staging = undefined;
        throw error;
      });
      return preview;
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  } });
}
