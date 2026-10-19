import fs from "node:fs";
import path from "node:path";
import { readOptionalText, readWindowsOneDriveRoots, type UserDirectoryOptions } from "./user-data-directories.js";

export type DirectorySyncProvider = "iCloud" | "OneDrive" | "Dropbox" | "Google Drive";

type SyncRoot = { root: string; provider: DirectorySyncProvider };
type PathApi = typeof path.posix;
interface SyncPorts {
  env: NodeJS.ProcessEnv; platform: NodeJS.Platform; readText: (file: string) => string | undefined;
  canonicalPath: (required: { path: string }) => string; listDirectories: (root: string) => string[]; exists: (file: string) => boolean;
  oneDriveRoots: readonly string[]; windowsOneDriveRoots: () => readonly string[];
}
const MOUNT_PROVIDERS: readonly (readonly [prefix: string, provider: DirectorySyncProvider])[] = [["OneDrive-", "OneDrive"], ["GoogleDrive-", "Google Drive"], ["Dropbox", "Dropbox"]];

function canonicalOrResolved({ path: value }: { path: string }): string { try { return fs.realpathSync(value); } catch { return path.resolve(value); } }
function listDirectoriesOrEmpty(root: string): string[] { try { return fs.readdirSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }

function macRoots({ homeDir, documents }: { homeDir: string; documents: string }, { paths, exists, listDirectories }: { paths: PathApi; exists: SyncPorts["exists"]; listDirectories: SyncPorts["listDirectories"] }): SyncRoot[] {
  const cloud = paths.join(homeDir, "Library", "Mobile Documents", "com~apple~CloudDocs");
  const roots: SyncRoot[] = [{ root: cloud, provider: "iCloud" }];
  // Documents need not be a symlink on newer macOS: the cloud Documents entry is evidence
  // of Desktop & Documents being enabled, rather than merely iCloud Drive being installed.
  if (exists(paths.join(cloud, "Documents")) && documents) roots.push({ root: documents, provider: "iCloud" });
  const mounts = paths.join(homeDir, "Library", "CloudStorage");
  for (const name of listDirectories(mounts)) {
    const provider = MOUNT_PROVIDERS.find(([prefix]) => name.startsWith(prefix))?.[1];
    if (provider) roots.push({ root: paths.join(mounts, name), provider });
  }
  return roots;
}

function oneDriveRoots({ env, platform, oneDriveRoots: extra, windowsOneDriveRoots }: SyncPorts): (string | undefined)[] {
  const fromEnv = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial];
  const fromAccounts = platform === "win32" && !fromEnv.some(Boolean) ? windowsOneDriveRoots() : [];
  return [...fromEnv, ...extra, ...fromAccounts];
}

function dropboxInfoFiles({ homeDir }: { homeDir: string }, { env, platform }: SyncPorts, paths: PathApi): string[] {
  if (platform !== "win32") return [paths.join(homeDir, ".dropbox", "info.json")];
  return [env.APPDATA, env.LOCALAPPDATA].filter((root): root is string => Boolean(root)).map((root) => paths.join(root, "Dropbox", "info.json"));
}

function dropboxAccountPaths(text: string | undefined): string[] {
  if (!text) return [];
  // Provider-owned metadata can be torn/corrupt; it is optional evidence, never a boot gate.
  let accounts: unknown;
  try { accounts = JSON.parse(text); } catch { return []; }
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) return [];
  return Object.values(accounts).map((account) => account?.path).filter((root): root is string => typeof root === "string");
}

function containingProvider({ dir, roots }: { dir: string; roots: readonly SyncRoot[] }, { canonicalPath, platform }: SyncPorts, paths: PathApi): DirectorySyncProvider | null {
  const canonical = (value: string) => { const resolved = canonicalPath({ path: value }); return platform === "win32" ? resolved.toLowerCase() : resolved; };
  const target = canonical(dir);
  for (const { root, provider } of roots) {
    const resolved = canonical(root);
    if (target === resolved || target.startsWith(resolved + paths.sep)) return provider;
  }
  return null;
}

function ancestorMarkerProvider({ dir }: { dir: string }, { exists }: SyncPorts, paths: PathApi): DirectorySyncProvider | null {
  let ancestor = paths.resolve(dir);
  while (true) {
    if (exists(paths.join(ancestor, ".dropbox.cache"))) return "Dropbox";
    if (exists(paths.join(ancestor, ".tmp.drivedownload")) || exists(paths.join(ancestor, ".tmp.driveupload"))) return "Google Drive";
    const parent = paths.dirname(ancestor);
    if (parent === ancestor) return null;
    ancestor = parent;
  }
}

function providerRoots(provider: DirectorySyncProvider, roots: readonly (string | undefined)[]): SyncRoot[] {
  return roots.filter((root): root is string => Boolean(root)).map((root) => ({ root, provider }));
}

function detectWithPorts({ dir, homeDir, documents }: { dir: string; homeDir: string; documents: string }, ports: SyncPorts): DirectorySyncProvider | null {
  const paths = ports.platform === "win32" ? path.win32 : path.posix;
  const mac = ports.platform === "darwin" ? macRoots({ homeDir, documents }, { paths, exists: ports.exists, listDirectories: ports.listDirectories }) : [];
  const oneDrive = providerRoots("OneDrive", oneDriveRoots(ports));
  const dropbox = providerRoots("Dropbox", dropboxInfoFiles({ homeDir }, ports, paths).flatMap((file) => dropboxAccountPaths(ports.readText(file))));
  return containingProvider({ dir, roots: [...mac, ...oneDrive, ...dropbox] }, ports, paths) ?? ancestorMarkerProvider({ dir }, ports, paths);
}

/** Detect provider roots, never infer syncing just because a provider is installed. Canonical
 * containment catches redirected Documents, while marker files cover older client layouts.
 * Dropbox publishes info.json paths; macOS File Provider mounts identify their provider.
 * @complexity O(a + p) small account/mount lists and ancestor probes, no recursive site scan.
 */
export function detectDirectorySync(
  required: { dir: string; homeDir: string; documents: string },
  { env = process.env, platform = process.platform, readText = (file) => readOptionalText({ file }),
    canonicalPath = canonicalOrResolved, listDirectories = listDirectoriesOrEmpty,
    exists = fs.existsSync, oneDriveRoots = [], windowsOneDriveRoots = () => readWindowsOneDriveRoots({}),
  }: UserDirectoryOptions & { canonicalPath?: (required: { path: string }) => string;
    listDirectories?: (root: string) => string[]; exists?: (file: string) => boolean; oneDriveRoots?: readonly string[] } = {},
): DirectorySyncProvider | null {
  return detectWithPorts(required, { env, platform, readText, canonicalPath, listDirectories, exists, oneDriveRoots, windowsOneDriveRoots });
}
