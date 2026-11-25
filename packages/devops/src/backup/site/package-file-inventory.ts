import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @file Which installed-package files a share may treat as public plugin content: exactly the files
 * THIS build ships. Each bundled source folder is packed with the seeder's own deterministic packer
 * (`packAgentPluginDirectory`), so its digest is the `package/sha256/<digest>/` folder the seeder
 * installs it under, and the packed entries are the package's file inventory. Nothing here reads the
 * site folder: a package-shaped path, `bundled-digests.json` and `activations.json` can all be written
 * by anyone who can write there, the product's bundled sources cannot.
 */

/** Digest -> (package-relative path -> SHA-256) for every bundled source folder. */
export type BundledPackageInventory = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The seeder's deterministic packer: one source folder -> its archive bytes and digest. */
export type PackBundledSourceDirectory = (required: { sourceDir: string }) => Promise<{ sha256: string; bytes: Uint8Array }>;

/** One entry of the installer's archive reader; only files are hashed. */
export interface BundledSourceArchiveEntry {
  readonly kind: string;
  readonly entryPath: string;
  openReadStream(): AsyncIterable<Uint8Array>;
}

/** The installer's own archive reader, so the inventory is read back exactly as the installer reads it. */
export type CreateBundledSourceArchiveReader = () => { entries(required: { archive: Uint8Array }): AsyncIterable<BundledSourceArchiveEntry> };

/** The host's bundled catalog reader; only the plugin ids are used. */
export type ListBundledAgentPluginServers = (required: { bundledSourceRoot: string }) => Promise<readonly { pluginId: string }[]>;

/** Host values for {@link readBundledPackageFiles}: where the sources live and how they pack/read. */
export interface BundledPackageFilesDeps {
  /** Folder holding one source folder per bundled package. */
  sourceRoot: string;
  packAgentPluginDirectory: PackBundledSourceDirectory;
  createBundledSourceArchiveReader: CreateBundledSourceArchiveReader;
}

/** Host values for {@link readBundledImportPluginIds}. */
export interface BundledImportPluginIdsDeps {
  sourceRoot: string;
  listBundledAgentPluginServers: ListBundledAgentPluginServers;
}

/**
 * Digest -> (package-relative path -> SHA-256) for every bundled source folder. A missing source root,
 * or a folder that does not pack, verifies nothing: its installed files then get the ordinary rules.
 * @complexity O(bundled source bytes): one pack and one hash per file.
 */
export async function readBundledPackageFiles(required: BundledPackageFilesDeps, _optional: Record<string, never> = {}): Promise<BundledPackageInventory> {
  const { sourceRoot } = required;
  const inventory = new Map<string, ReadonlyMap<string, string>>();
  const folders = await readdir(sourceRoot, { withFileTypes: true }).catch((error: unknown): Dirent[] => {
    // An absent bundled source root is a normal installation without bundled identities.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) console.warn("[site-backup] Could not read bundled packages", describeErrorForLog({ err: error }));
    return [];
  });
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    // An invalid bundled folder has no trusted package identity and gets ordinary file rules.
    const packed = await required.packAgentPluginDirectory({ sourceDir: path.join(sourceRoot, folder.name) }).catch((error: unknown) => {
      // A folder removed during the scan simply cannot establish trusted package identity.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) console.warn("[site-backup] Could not inspect a bundled package", describeErrorForLog({ err: error }));
      return null;
    });
    if (packed) inventory.set(packed.sha256, await packedFileHashes({ bytes: packed.bytes, createReader: required.createBundledSourceArchiveReader }));
  }
  return inventory;
}

/** Import scan classification comes from this build's catalog, never the archive's `shipped` flag.
 * This grants no execution trust: restore seeds local code and quarantines the imported package.
 * @returns Known bundled ids; an absent/unreadable source root recognises none.
 * @complexity O(bundled plugin manifests and MCP declarations), via the existing catalog reader.
 */
export async function readBundledImportPluginIds(required: BundledImportPluginIdsDeps, _optional: Record<string, never> = {}): Promise<ReadonlySet<string>> {
  const plugins = await required.listBundledAgentPluginServers({ bundledSourceRoot: required.sourceRoot });
  return new Set(plugins.map(plugin => plugin.pluginId));
}

/** The packed archive read back with the installer's own reader. O(archive bytes). */
async function packedFileHashes(required: { bytes: Uint8Array; createReader: CreateBundledSourceArchiveReader }): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for await (const entry of required.createReader().entries({ archive: required.bytes })) {
    if (entry.kind !== "file") continue;
    const hash = createHash("sha256");
    for await (const chunk of entry.openReadStream()) hash.update(chunk);
    files.set(entry.entryPath, hash.digest("hex"));
  }
  return files;
}
