/** Local-install environment consent is host-owned; archiveReader owns zip-slip/decompression
 * checks and tierPolicy.checkInstall owns publisher admission. */
/** Site plugin folder installer governed by plugin-install-plan.md, M1a.
 * Installation inspects JSON and bytes only: importing code belongs exclusively to enable.
 * Staging is a sibling of discovery's root, on the same filesystem, so partial copies never list.
 */
import { constants } from "node:fs";
import { lstat, realpath, readdir, open, mkdir, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as semver from "semver";
import { validateManifest, type PluginManifest, type PluginTier } from "../manifest.js";
import type { ArchiveReaderPort, ManifestHostPorts, PluginTierPolicy } from "../ports.js";
import type { PluginActivationRepoPort } from "../activation.js";
import type { PluginConflict } from "../plugin-claims.js";

export class PluginInstallError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PluginInstallError"; }
}
export interface PluginInstallPreview {
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
  readonly archiveReader: ArchiveReaderPort;
  readonly tierPolicy: PluginTierPolicy;
  installDir: string; builtInIds: readonly string[];
  repo: Pick<PluginActivationRepoPort, "listAll">;
  /** Names the staged manifest would take that core or an enabled plugin already holds. Install is
   *  site-wide but activation is per workspace: the admin root answers for the workspace it serves
   *  (`composePluginRuntime`); the CLI, which names no workspace, answers none. */
  conflicts: (required: { manifest: PluginManifest }, optional?: Record<string, never>) => Promise<readonly PluginConflict[]>;
}
export interface PluginInstallerPort {
  preview(required: PluginInstallInput, optional?: Record<string, never>): Promise<PluginInstallPreview>;
  install(required: PluginInstallInput & { expectedDigest: string }, optional?: Record<string, never>): Promise<PluginInstallPreview>;
}
const MANIFEST = "tovu.plugin.json";
const MAX_ENTRIES = 4096;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const hash = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
function fail(code: string, message: string): never { throw new PluginInstallError(code, message); }
const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);
async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
/** Activation callbacks share this guard; the activation service compensates a rejected enable. */
export async function assertPluginInstallIdle(required: { installDir: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (await exists(path.resolve(required.installDir) + "-install-lock")) fail("PLUGIN_INSTALL_BUSY", "Another install is in progress.");
}

/** Retain the inspected bytes, rather than copying a mutable source after consent verification. */
async function snapshot(sourceDir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let entries = 0; let total = 0;
  async function walk(dir: string, prefix: string): Promise<void> {
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Package directories must not be symbolic links.");
    for (const name of (await readdir(dir)).sort()) {
      if (++entries > MAX_ENTRIES) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package has too many entries.");
      const target = path.join(dir, name); const relative = prefix + name;
      const info = await lstat(target);
      if (info.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Symbolic links are not allowed.");
      if (info.isDirectory()) { await walk(target, relative + "/"); continue; }
      if (!info.isFile() || info.nlink !== 1) fail("PLUGIN_PACKAGE_UNSAFE", "Only regular files without hard links are allowed.");
      if (info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package exceeds the file or total size limit.");
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.nlink !== 1 || current.ino !== info.ino || current.dev !== info.dev) fail("PLUGIN_PACKAGE_UNSAFE", "Package changed while reading.");
        // A bounded read also protects against a file growing after stat().
        const buffer = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await handle.read(buffer, length, buffer.length - length, null);
          if (read.bytesRead === 0) break;
          length += read.bytesRead;
        }
        if (length > MAX_FILE_BYTES || total + length > MAX_TOTAL_BYTES) fail("PLUGIN_PACKAGE_TOO_LARGE", "Package grew past its size limit.");
        if (length > info.size || (await handle.stat()).size !== length) fail("PLUGIN_PACKAGE_UNSAFE", "Package changed while reading.");
        total += length; files.set(relative, Buffer.from(buffer.subarray(0, length)));
      } finally { await handle.close(); }
    }
  }
  await walk(sourceDir, ""); return files;
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
    const code = [...files.keys()].filter((key) => key !== MANIFEST && !DECLARATIVE_DATA_FILE.test(key));
    if (code.length) fail("PLUGIN_MANIFEST_INVALID", `A declarative (tier-1) plugin must not ship code: ${code.join(", ")}`);
    return;
  }
  if (!files.has("server/index.mjs")) fail("PLUGIN_MANIFEST_INVALID", "server/index.mjs is required.");
  tierPolicy.checkInstall({ manifest: candidate, files });
}

function validatePackage(files: Map<string, Buffer>, deps: PluginInstallDeps): PluginManifest {
  const { builtInIds } = deps;
  let raw: unknown;
  try { raw = JSON.parse(files.get(MANIFEST)?.toString("utf8") ?? ""); }
  catch { return fail("PLUGIN_MANIFEST_INVALID", "A valid tovu.plugin.json is required."); }
  const candidate = raw as PluginManifest | null;
  const id = typeof candidate?.id === "string" ? candidate.id : "";
  if (builtInIds.some((builtin) => builtin.toLowerCase() === id.toLowerCase())) fail("PLUGIN_SHADOWS_BUILT_IN", "Package id belongs to a built-in plugin.");
  const result = validateManifest({ ...deps, manifest: raw, folderName: id, builtInIds });
  // The manifest's own messages, so a refused declaration says what is wrong with it.
  if (result.errors.length) fail("PLUGIN_MANIFEST_INVALID", result.errors.map((error) => error.message).join("; "));
  if (!candidate || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || typeof candidate.version !== "string" || !semver.valid(candidate.version) || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(candidate.version)) fail("PLUGIN_MANIFEST_INVALID", "Package manifest, id or version is invalid.");
  checkTierAndCode(candidate, files, deps.tierPolicy);
  if (typeof candidate.name !== "string" || !candidate.name.trim() || typeof candidate.sdkRange !== "string" || !semver.validRange(candidate.sdkRange)) fail("PLUGIN_MANIFEST_INVALID", "A name and valid SDK range are required.");
  if (!candidate.integrity || typeof candidate.integrity !== "object" || Array.isArray(candidate.integrity)) fail("PLUGIN_INTEGRITY_INVALID", "An integrity map is required.");
  const packaged = [...files.keys()].filter((key) => key !== MANIFEST).sort();
  if (JSON.stringify(Object.keys(candidate.integrity).sort()) !== JSON.stringify(packaged)) fail("PLUGIN_INTEGRITY_INVALID", "Integrity must list exactly every file except tovu.plugin.json.");
  for (const key of packaged) if (candidate.integrity[key] !== hash(files.get(key)!)) fail("PLUGIN_INTEGRITY_INVALID", `Integrity mismatch: ${key}`);
  return candidate;
}

async function checkDestination(manifest: PluginManifest, input: PluginInstallInput, deps: PluginInstallDeps): Promise<string | undefined> {
  const root = path.resolve(deps.installDir);
  const entries = await readdir(root).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
  if (entries.some((name) => name.toLowerCase() === manifest.id.toLowerCase() && name !== manifest.id)) fail("PLUGIN_ID_CONFLICT", "A plugin id differs only by letter case.");
  if (await exists(path.join(path.dirname(root), path.basename(root) + "-trash", manifest.id))) fail("PLUGIN_IN_TRASH", "Restore or delete this plugin in Trash first.");
  if ((await deps.repo.listAll()).some((row) => row.pluginId.toLowerCase() === manifest.id.toLowerCase() && row.enabled)) fail("PLUGIN_ENABLED", "Turn the plugin off in every workspace first.");
  const slot = path.join(root, manifest.id);
  if (!(await exists(slot))) return undefined;
  const stat = await lstat(slot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Installed plugin directory must not be a link.");
  const versions = await readdir(slot);
  if (versions.some((version) => !semver.valid(version))) fail("PLUGIN_ID_CONFLICT", "Existing plugin has an unrecognized version folder.");
  const latest = versions.sort(semver.rcompare)[0];
  if (latest && semver.lt(manifest.version, latest)) fail("PLUGIN_DOWNGRADE", "Installing an older version is not allowed.");
  if (versions.some((version) => semver.eq(version, manifest.version)) && !input.replace) fail("PLUGIN_VERSION_EXISTS", "This version exists. Choose replace explicitly.");
  return latest;
}

async function inspect(input: PluginInstallInput, deps: PluginInstallDeps) {
  const files = input.archive !== undefined ? new Map([...await deps.archiveReader({ archive: input.archive })].map(([key, bytes]) => [key, Buffer.from(bytes)])) : await inspectFolder(input.sourceDir!, deps);
  const manifest = validatePackage(files, deps);
  const upgradeFrom = await checkDestination(manifest, input, deps);
  // Include manifest bytes: changed capabilities/name/version must invalidate human consent too.
  const digest = hash(Buffer.from(JSON.stringify([...files].map(([key, bytes]) => [key, hash(bytes)]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0))));
  const preview: PluginInstallPreview = { id: manifest.id, name: manifest.name, version: manifest.version, tier: manifest.tier, capabilities: manifest.capabilities, hooks: manifest.hooks, hasCode: manifest.tier !== "tier-1", contentTypes: deps.declarativeContentTypes.parse({ value: manifest.contentTypes }).decls.map((decl) => decl.key), conflicts: await deps.conflicts({ manifest }), digest, ...(upgradeFrom ? { upgradeFrom } : {}) };
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
export async function snapshotSitePluginPackage(required: { sourceDir: string }, _optional: Record<string, never> = {}): Promise<Map<string, Buffer>> {
  return snapshot(required.sourceDir);
}

export async function computePluginIntegrity(required: { sourceDir: string }, _optional: Record<string, never> = {}): Promise<Record<string, string>> {
  return Object.fromEntries([...await snapshot(required.sourceDir)].filter(([key]) => key !== MANIFEST).map(([key, bytes]) => [key, hash(bytes)]));
}
export async function previewSitePluginInstall(required: PluginInstallInput & { deps: PluginInstallDeps }, _optional: Record<string, never> = {}): Promise<PluginInstallPreview> {
  return (await inspect(required, required.deps)).preview;
}

/** Directory lock is also cross-process: CLI and admin cannot replace the same site concurrently. */
export async function installSitePlugin(required: PluginInstallInput & { expectedDigest: string; deps: PluginInstallDeps }, _optional: Record<string, never> = {}): Promise<PluginInstallPreview> {
  const optional = required.deps;
  const root = path.resolve(optional.installDir);
  const { files, manifest, preview } = await inspect(required, optional);
  if (preview.digest !== required.expectedDigest) fail("PLUGIN_CHANGED_SINCE_PREVIEW", "Package changed since preview. Review it again.");
  for (const target of [root, root + "-staging", root + "-trash"]) {
    if (await exists(target)) {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("PLUGIN_PACKAGE_UNSAFE", "Install, staging and Trash roots must be real directories.");
    }
  }
  const lock = root + "-install-lock";
  await mkdir(path.dirname(root), { recursive: true });
  try { await mkdir(lock); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") fail("PLUGIN_INSTALL_BUSY", "Another install is in progress."); throw e; }
  let staging: string | undefined;
  try {
    await mkdir(root + "-staging", { recursive: true });
    staging = await mkdtemp(path.join(root + "-staging", "install-"));
    const stagedSlot = path.join(staging, "new");
    const versionDir = path.join(stagedSlot, manifest.version);
    for (const [key, bytes] of files) {
      const target = path.join(versionDir, key);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
    }
    await checkDestination(manifest, required, optional);
    await mkdir(root, { recursive: true });
    const live = path.join(root, manifest.id);
    if (!(await exists(live))) {
      await rename(stagedSlot, live);
    } else {
      const liveVersion = path.join(live, manifest.version);
      const backup = path.join(staging, "old");
      const replaced = await exists(liveVersion);
      if (replaced) await rename(liveVersion, backup);
      try { await rename(versionDir, liveVersion); }
      catch (error) {
        if (replaced) {
          try { await rename(backup, liveVersion); }
          catch {
            // Never let cleanup erase the sole remaining copy when rollback itself fails.
            staging = undefined;
            fail("PLUGIN_INSTALL_RECOVERY_REQUIRED", `Restore the previous version from ${backup} before retrying.`);
          }
        }
        throw error;
      }
      // Publish first, retire old versions second: discovery always sees a complete upgrade.
      for (const version of await readdir(live)) {
        if (version !== manifest.version) await rm(path.join(live, version), { recursive: true, force: true });
      }
    }
    return preview;
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }
}
