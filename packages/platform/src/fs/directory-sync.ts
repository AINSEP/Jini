import fs from "node:fs";
import path from "node:path";
import { readOptionalText, readWindowsOneDriveRoots, type UserDirectoryOptions } from "./user-data-directories.js";

export type DirectorySyncProvider = "iCloud" | "OneDrive" | "Dropbox" | "Google Drive";

/** Detect provider roots, never infer syncing just because a provider is installed. Canonical
 * containment catches redirected Documents, while marker files cover older client layouts.
 * Dropbox publishes info.json paths; macOS File Provider mounts identify their provider.
 * @complexity O(a + p) small account/mount lists and ancestor probes, no recursive site scan.
 */
export function detectDirectorySync(
  { dir, homeDir, documents }: { dir: string; homeDir: string; documents: string },
  { env = process.env, platform = process.platform, readText = (file) => readOptionalText({ file }),
    canonicalPath = ({ path: value }) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } },
    listDirectories = (root) => { try { return fs.readdirSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } },
    exists = fs.existsSync, oneDriveRoots = [], windowsOneDriveRoots = () => readWindowsOneDriveRoots({}),
  }: UserDirectoryOptions & { canonicalPath?: (required: { path: string }) => string;
    listDirectories?: (root: string) => string[]; exists?: (file: string) => boolean; oneDriveRoots?: readonly string[] } = {},
): DirectorySyncProvider | null {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const roots: { root: string; provider: DirectorySyncProvider }[] = [];
  const add = (root: string | undefined, provider: DirectorySyncProvider) => { if (root) roots.push({ root, provider }); };
  if (platform === "darwin") {
    const cloud = paths.join(homeDir, "Library", "Mobile Documents", "com~apple~CloudDocs");
    add(cloud, "iCloud");
    // Documents need not be a symlink on newer macOS: the cloud Documents entry is evidence
    // of Desktop & Documents being enabled, rather than merely iCloud Drive being installed.
    if (exists(paths.join(cloud, "Documents"))) add(documents, "iCloud");
    const mounts = paths.join(homeDir, "Library", "CloudStorage");
    for (const name of listDirectories(mounts)) {
      if (name.startsWith("OneDrive-")) add(paths.join(mounts, name), "OneDrive");
      else if (name.startsWith("GoogleDrive-")) add(paths.join(mounts, name), "Google Drive");
      else if (name.startsWith("Dropbox")) add(paths.join(mounts, name), "Dropbox");
    }
  }
  for (const root of [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial, ...oneDriveRoots]) add(root, "OneDrive");
  if (platform === "win32" && !env.OneDrive && !env.OneDriveConsumer && !env.OneDriveCommercial) {
    for (const root of windowsOneDriveRoots()) add(root, "OneDrive");
  }
  const dropboxFiles = platform === "win32" ? [env.APPDATA, env.LOCALAPPDATA].filter((root): root is string => Boolean(root)).map((root) => paths.join(root, "Dropbox", "info.json")) : [paths.join(homeDir, ".dropbox", "info.json")];
  for (const file of dropboxFiles) {
    const text = readText(file);
    if (!text) continue;
    const accounts = JSON.parse(text) as Record<string, { path?: unknown }>;
    for (const account of Object.values(accounts)) if (typeof account?.path === "string") add(account.path, "Dropbox");
  }
  const canonical = (value: string) => { const resolved = canonicalPath({ path: value }); return platform === "win32" ? resolved.toLowerCase() : resolved; };
  const target = canonical(dir);
  for (const { root, provider } of roots) {
    const resolved = canonical(root);
    if (target === resolved || target.startsWith(resolved + paths.sep)) return provider;
  }
  let ancestor = paths.resolve(dir);
  while (true) {
    if (exists(paths.join(ancestor, ".dropbox.cache"))) return "Dropbox";
    if (exists(paths.join(ancestor, ".tmp.drivedownload")) || exists(paths.join(ancestor, ".tmp.driveupload"))) return "Google Drive";
    const parent = paths.dirname(ancestor);
    if (parent === ancestor) return null;
    ancestor = parent;
  }
}
