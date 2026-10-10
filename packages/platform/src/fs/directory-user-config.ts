import path from "node:path";
import { createHash } from "node:crypto";
import type { DurableJsonFile } from "./durable-json.js";
import { resolveDirectoryHome } from "./directory-home.js";
import { resolveUserDataDirectories, type UserDirectoryOptions } from "./user-data-directories.js";
import { detectDirectorySync } from "./directory-sync.js";

export interface DirectoryUserConfig { sitesHome: string; siteRoots: string[]; databases: "inSite" | "appData"; }
export interface DirectoryUserConfigPolicy {
  appName: string;
  rootsEnvName: string;
  sourceRoots?: readonly string[];
  legacySettingsFile?: string;
  legacyDefaultFolder?: string;
}

/** One atomic settings owner for multiple processes. Existing DB files always win over preferences:
 * changing placement controls new databases, never silently moves or abandons existing ones.
 * @complexity O(n) canonicalizations for n roots; DB lookup probes three fixed locations.
 */
export function createDirectoryUserConfig(
  { homeDir, defaultFolder, envName, policy, fileAt, canonicalPath, exists, isDirectory }: {
    homeDir: string; defaultFolder: string; envName: string; policy: DirectoryUserConfigPolicy;
    fileAt: (file: string) => DurableJsonFile; canonicalPath: (required: { path: string }) => string;
    exists: (file: string) => boolean; isDirectory: (file: string) => boolean;
  }, { env = process.env, cwd = process.cwd(), report = console.warn, ...directoryOptions }: UserDirectoryOptions & { cwd?: string; report?: (message: string) => void } = {},
) {
  const directories = resolveUserDataDirectories({ homeDir, appName: policy.appName }, { ...directoryOptions, env });
  const filePath = path.join(directories.appData, "config.json"), file = fileAt(filePath);
  const expand = (value: string) => canonicalPath({ path: resolveDirectoryHome({ homeDir, defaultFolder, envName, env: {}, setting: value }, { cwd }) });
  const distinct = (values: readonly string[]) => [...new Set(values.map(expand))];
  function stored(locked = false): Partial<DirectoryUserConfig> {
    const result = file.read({});
    if (result.state === "missing") return {};
    if (result.state === "ok") {
      try { return validateDirectoryUserConfig({ value: result.value }); } catch { /* preserve invalid settings too */ }
    }
    // Bad settings must not stop boot, and read-only discovery/dry-run must not mutate settings.
    // Preserve the original on reads; the next mutation quarantines it under the existing lock.
    if (!locked) {
      report(`User config is unreadable: ${filePath}. Using defaults; the original was left untouched.`);
      return {};
    }
    if (!file.quarantine({ notice: { label: "user config", consequence: "Using default settings; existing databases keep their locations." } })) {
      throw new Error(`User config is unreadable: ${filePath}. Nothing was overwritten.`);
    }
    return {};
  }
  const syncProvider = (sitesHome: string) => detectDirectorySync({ dir: sitesHome, homeDir, documents: directories.documents }, { ...directoryOptions, env, canonicalPath });
  function read(_required: Record<string, never>, _options = {}): DirectoryUserConfig {
    const saved = stored();
    const sitesHome = expand(env[envName] ?? saved.sitesHome ?? path.join(directories.documents, defaultFolder));
    const sync = syncProvider(sitesHome);
    return {
      sitesHome,
      siteRoots: distinct(env[policy.rootsEnvName] !== undefined ? env[policy.rootsEnvName]!.split(",").map((root) => root.trim()).filter(Boolean) : saved.siteRoots ?? policy.sourceRoots ?? []),
      databases: saved.databases ?? (sync && sync !== "iCloud" ? "appData" : "inSite"),
    };
  }
  function update({ patch }: { patch: Partial<DirectoryUserConfig> }, { transform }: { transform?: (current: DirectoryUserConfig) => Partial<DirectoryUserConfig> } = {}): DirectoryUserConfig {
    // Compute incremental root changes inside the same lock as the write: a sibling process's
    // added root must not disappear because this caller previously read an older array.
    file.withLock({ critical: () => {
      const previous = stored(true);
      const checked = validateDirectoryUserConfig({ value: transform ? transform(read({})) : patch });
      // Prefer explicit settings, never coerce an existing regular file into a directory.
      for (const directory of [checked.sitesHome, ...(checked.siteRoots ?? [])]) {
        if (directory === undefined) continue;
        const expanded = expand(directory);
        if (exists(expanded) && !isDirectory(expanded)) throw new Error(`Sites folder is not a directory: ${directory}`);
      }
      if (checked.sitesHome !== undefined && env[envName] !== undefined) throw new Error(`${envName} overrides this setting. Unset it before changing the directory home.`);
      if (checked.siteRoots !== undefined && env[policy.rootsEnvName] !== undefined) throw new Error(`${policy.rootsEnvName} overrides this setting. Unset it before changing site roots.`);
      file.write({ value: { ...previous, ...checked,
        ...(checked.sitesHome !== undefined ? { sitesHome: expand(checked.sitesHome) } : {}),
        ...(checked.siteRoots !== undefined ? { siteRoots: distinct(checked.siteRoots) } : {}),
      } });
    } });
    return read({});
  }
  function updateRoots({ add = [], remove = [] }: { add?: readonly string[]; remove?: readonly string[] }, _options = {}): DirectoryUserConfig {
    return update({ patch: {} }, { transform: (current) => {
      const excluded = new Set(distinct(remove));
      return { siteRoots: distinct([...current.siteRoots, ...add]).filter((root) => !excluded.has(root)) };
    } });
  }
  function databasePath({ dir, id, filename, placement }: { dir: string; id: string; filename: string; placement?: DirectoryUserConfig["databases"] }, _options = {}): string {
    if (path.basename(filename) !== filename || !filename.endsWith(".db")) throw new Error("A database filename must be a .db basename.");
    const inSite = path.join(dir, "data.nosync", filename), legacy = path.join(dir, filename);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      if (!placement && exists(legacy)) return legacy;
      throw new Error("A database directory requires a safe, stable site identity.");
    }
    const appData = path.join(directories.appData, "databases", id, filename);
    if (placement) return placement === "inSite" ? inSite : appData;
    const candidates = [legacy, inSite, appData];
    // A move journal is written before copying; the old name stays authoritative until verification
    // retires it. Recovery never guesses from two DB sizes/timestamps or asks users to delete data.
    for (const source of candidates) {
      const markerPath = source + ".home2-relocation.json", marker = fileAt(markerPath).read({});
      if (marker.state === "missing") continue;
      const target = marker.state === "ok" ? (marker.value as { to?: unknown } | null)?.to : undefined;
      if (typeof target !== "string" || !candidates.includes(target)) throw new Error(`Interrupted database move has an invalid recovery marker: ${markerPath}. Restore the pre-move backup before starting.`);
      const authoritative = exists(source) ? source : exists(source + ".home2-backup") && exists(target) ? target : undefined;
      if (!authoritative) throw new Error(`Interrupted database move needs recovery: ${markerPath}. Restore the pre-move backup before starting.`);
      report(`Recovered interrupted database move using ${authoritative}. Keep the .home2-backup files; finish the move before changing database placement.`);
      return authoritative;
    }
    const present = candidates.filter(exists);
    if (present.length > 1) throw new Error(`Multiple copies of ${filename} exist for this site. Choose the authoritative database before starting it.`);
    if (present[0]) return present[0];
    // A missing chat DB follows an existing content DB even after the user changes preferences.
    if (filename !== "content.db") {
      const content = databasePath({ dir, id, filename: "content.db" });
      return path.join(path.dirname(content), filename);
    }
    return read({}).databases === "inSite" ? inSite : appData;
  }
  return { read, update, updateRoots, databasePath, filePath, ...directories,
    roots: (_required: Record<string, never>, _options = {}) => { const config = read({}); return distinct([config.sitesHome, ...config.siteRoots]); },
    runningPath: ({ dir }: { dir: string }, _options = {}) => path.join(directories.appData, "running", createHash("sha256").update(canonicalPath({ path: dir })).digest("hex") + ".json"),
    syncWarning: (_required: Record<string, never>, _options = {}) => {
      const config = read({});
      const sync = syncProvider(config.sitesHome);
      if (!sync || sync === "iCloud") return null;
      return { provider: sync, message: config.databases === "appData" ? `${sync} syncs the sites folder. New databases use OS app-data for safety. Site folders are not self-contained: include their app-data databases when transferring them.` : `${sync} syncs the sites folder. It does not honor data.nosync; syncing live SQLite databases can corrupt them. Use app-data databases or a local sites folder.`, localHome: path.join(homeDir, defaultFolder) };
    },
  };
}

/** Validate only the three public settings; reject arrays, unknown fields and invalid enums.
 * @complexity O(n) root strings. No I/O or mutation.
 */
export function validateDirectoryUserConfig({ value }: { value: unknown }, _options = {}): Partial<DirectoryUserConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("User config must be an object.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["sitesHome", "siteRoots", "databases"].includes(key))) throw new Error("Unknown user config setting.");
  if (row.sitesHome !== undefined && (typeof row.sitesHome !== "string" || !row.sitesHome.trim())) throw new Error("sitesHome must name a directory.");
  if (row.siteRoots !== undefined && (!Array.isArray(row.siteRoots) || !row.siteRoots.every((root) => typeof root === "string" && root.trim()))) throw new Error("siteRoots must be an array of directory paths.");
  if (row.databases !== undefined && row.databases !== "inSite" && row.databases !== "appData") throw new Error('databases must be "inSite" or "appData".');
  return row as Partial<DirectoryUserConfig>;
}
