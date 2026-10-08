/** Site-plugin graph isolation. A fresh filesystem identity covers relative ESM, dynamic imports
 * and CommonJS requires together; a query on the entry alone covers only that entry.
 * Snapshots live outside discovery and remain available for late dynamic imports until shutdown.
 */
import { mkdir, mkdtemp, rm, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { snapshotSitePluginPackage } from "./install.js";
import type { PluginManifest } from "../manifest.js";

export class PluginSnapshotIntegrityError extends Error {}

/**
 * Copies a site plugin's verified package into a fresh, read-only runtime snapshot and returns the
 * snapshot's server entry. Every file must match the manifest's integrity map, and every listed file
 * must exist; a failed copy removes the half-written snapshot.
 * @param required.pluginRoot The installed package directory.
 * @param required.manifest The installed manifest whose `integrity` map is enforced.
 * @param optional.writeSnapshotFile File writer for the snapshot; defaults to `fs.writeFile`.
 * @throws {PluginSnapshotIntegrityError} On a changed/missing file or a linked runtime root.
 * @complexity O(total package bytes).
 */
export async function snapshotPluginModuleGraph(
  required: { pluginRoot: string; manifest: PluginManifest },
  { writeSnapshotFile = writeFile }: { writeSnapshotFile?: typeof writeFile } = {},
): Promise<string> {
  const files = await snapshotSitePluginPackage({ sourceDir: required.pluginRoot });
  for (const [key, bytes] of files) {
    if (key === "tovu.plugin.json") continue;
    const digest = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
    if (required.manifest.integrity[key] !== digest) throw new PluginSnapshotIntegrityError("Package changed before loading.");
  }
  for (const key of Object.keys(required.manifest.integrity)) {
    if (!files.has(key)) throw new PluginSnapshotIntegrityError("Package file disappeared before loading.");
  }
  const cacheRoot = path.dirname(path.dirname(required.pluginRoot)) + "-runtime";
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(cacheRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new PluginSnapshotIntegrityError("Runtime snapshot root must not be a link.");
  const snapshotRoot = await mkdtemp(path.join(cacheRoot, "load-"));
  try {
    for (const [key, bytes] of files) {
      const destination = path.join(snapshotRoot, key);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeSnapshotFile(destination, bytes, { flag: "wx", mode: 0o400 });
    }
    return path.join(snapshotRoot, "server/index.mjs");
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}
