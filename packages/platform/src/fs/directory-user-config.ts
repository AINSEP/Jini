import path from "node:path";
import { createHash } from "node:crypto";
import type { DurableJsonFile } from "./durable-json.js";
import { resolveDirectoryHome } from "./directory-home.js";
import { resolveUserDataDirectories, type UserDirectoryOptions } from "./user-data-directories.js";
import { detectDirectorySync, type DirectorySyncProvider } from "./directory-sync.js";

export interface DirectoryUserConfig { sitesHome: string; siteRoots: string[]; databases: "inSite" | "appData"; }
export interface DirectoryUserConfigPolicy {
  appName: string;
  rootsEnvName: string;
  sourceRoots?: readonly string[];
  legacySettingsFile?: string;
  legacyDefaultFolder?: string;
  /** Nest new workspaces while retaining immediate old-level children for discovery. */
  defaultSubfolder?: string;
}

const SAFE_SITE_ID = /^[a-zA-Z0-9_-]+$/;
const invalidMarker = (markerPath: string) => new Error(`Interrupted database move has an invalid recovery marker: ${markerPath}. Restore the pre-move backup before starting.`);
function assertDatabaseFilename(filename: string): void {
  if (path.basename(filename) !== filename || !filename.endsWith(".db")) throw new Error("A database filename must be a .db basename.");
}
/** iCloud keeps data.nosync out of sync; every other provider syncs live databases. */
function syncsDatabases(sync: DirectorySyncProvider | null): sync is Exclude<DirectorySyncProvider, "iCloud"> { return sync !== null && sync !== "iCloud"; }
/** Old markers use the fixed home2 name; new moves identify their unique backup. Admit
 * only a sibling of this source so malformed metadata cannot supply unrelated evidence. */
function markerBackup(source: string, namedBackup: unknown): string | undefined {
  if (namedBackup === undefined) return source + ".home2-backup";
  if (typeof namedBackup !== "string" || path.dirname(namedBackup) !== path.dirname(source) || !namedBackup.startsWith(source + ".relocation-") || !namedBackup.endsWith("-backup")) return undefined;
  return namedBackup;
}

/** One atomic settings owner for multiple processes. Existing DB files always win over preferences:
 * changing placement controls new databases, never silently moves or abandons existing ones.
 * @complexity O(n) canonicalizations for n roots; DB lookup probes three fixed locations.
 */
export function createDirectoryUserConfig(
  { homeDir, defaultFolder, envName, policy, fileAt, canonicalPath, exists, isDirectory, removeFile }: {
    homeDir: string; defaultFolder: string; envName: string; policy: DirectoryUserConfigPolicy;
    fileAt: (file: string) => DurableJsonFile; canonicalPath: (required: { path: string }) => string;
    exists: (file: string) => boolean; isDirectory: (file: string) => boolean;
    removeFile?: (required: { filePath: string }) => void;
  }, { env = process.env, cwd = process.cwd(), report = console.warn, ...directoryOptions }: UserDirectoryOptions & { cwd?: string; report?: (message: string) => void } = {},
) {
  const directories = resolveUserDataDirectories({ homeDir, appName: policy.appName }, { ...directoryOptions, env });
  const paths = directoryOptions.platform === "win32" ? path.win32 : path;
  const defaultHome = paths.join(directories.documents, defaultFolder, policy.defaultSubfolder ?? "");
  const localHome = paths.join(homeDir, defaultFolder, policy.defaultSubfolder ?? "");
  const legacyHomePaths = policy.defaultSubfolder ? [paths.join(directories.documents, defaultFolder), paths.join(homeDir, defaultFolder)] : [];
  const filePath = paths.join(directories.appData, "config.json"), file = fileAt(filePath);
  const expand = (value: string) => canonicalPath({ path: resolveDirectoryHome({ homeDir, defaultFolder, envName, env: {}, setting: value }, { cwd, ...(directoryOptions.platform ? { platform: directoryOptions.platform } : {}) }) });
  const distinct = (values: readonly string[]) => [...new Set(values.map(expand))];
  const legacyHomes = distinct(legacyHomePaths);
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
    // Old default pointers follow the owner-selected nesting rule; arbitrary custom homes and
    // explicit environment overrides keep their contracts. Reading never moves user folders.
    const savedHome = saved.sitesHome === undefined ? defaultHome : expand(saved.sitesHome);
    const nestedHome = legacyHomes.includes(savedHome) ? paths.join(savedHome, policy.defaultSubfolder!) : savedHome;
    const sitesHome = expand(env[envName] ?? nestedHome);
    const sync = syncProvider(sitesHome);
    return { sitesHome, siteRoots: distinct(configuredRoots(saved)), databases: saved.databases ?? (syncsDatabases(sync) ? "appData" : "inSite") };
  }
  function configuredRoots(saved: Partial<DirectoryUserConfig>): readonly string[] {
    const fromEnv = env[policy.rootsEnvName];
    // Saved roots are extras; policy roots remain implicit unless the environment overrides them.
    return fromEnv !== undefined ? fromEnv.split(",").map((root) => root.trim()).filter(Boolean) : [...(policy.sourceRoots ?? []), ...(saved.siteRoots ?? [])];
  }
  // Prefer explicit settings, never coerce an existing regular file into a directory.
  function assertDirectories(checked: Partial<DirectoryUserConfig>): void {
    for (const directory of [checked.sitesHome, ...(checked.siteRoots ?? [])]) {
      if (directory === undefined) continue;
      const expanded = expand(directory);
      if (exists(expanded) && !isDirectory(expanded)) throw new Error(`Sites folder is not a directory: ${directory}`);
    }
  }
  function assertNotOverridden(checked: Partial<DirectoryUserConfig>): void {
    if (checked.sitesHome !== undefined && env[envName] !== undefined) throw new Error(`${envName} overrides this setting. Unset it before changing the directory home.`);
    if (checked.siteRoots !== undefined && env[policy.rootsEnvName] !== undefined) throw new Error(`${policy.rootsEnvName} overrides this setting. Unset it before changing site roots.`);
  }
  function merged(previous: Partial<DirectoryUserConfig>, checked: Partial<DirectoryUserConfig>, incremental: boolean): Partial<DirectoryUserConfig> {
    const next = { ...previous, ...checked,
      ...(checked.sitesHome !== undefined ? { sitesHome: expand(checked.sitesHome) } : {}),
      ...(checked.siteRoots !== undefined ? { siteRoots: distinct(checked.siteRoots) } : {}),
    };
    // Empty incremental extras restore implicit defaults instead of persisting those defaults.
    if (incremental && checked.siteRoots?.length === 0) delete next.siteRoots;
    return next;
  }
  function update({ patch }: { patch: Partial<DirectoryUserConfig> }, { transform }: { transform?: (current: DirectoryUserConfig, saved: Partial<DirectoryUserConfig>) => Partial<DirectoryUserConfig> } = {}): DirectoryUserConfig {
    // Compute incremental root changes inside the same lock as the write: a sibling process's
    // added root must not disappear because this caller previously read an older array.
    file.withLock({ critical: () => {
      const previous = stored(true);
      const checked = validateDirectoryUserConfig({ value: transform ? transform(read({}), previous) : patch });
      assertDirectories(checked);
      assertNotOverridden(checked);
      const next = merged(previous, checked, transform !== undefined);
      // With no other saved settings, removing the final extra also restores an absent config.
      // The Node assembly supplies removal; non-Node adapters may retain the equivalent {}.
      if (transform && Object.keys(next).length === 0 && removeFile) removeFile({ filePath });
      else file.write({ value: next });
    } });
    return read({});
  }
  function updateRoots({ add = [], remove = [] }: { add?: readonly string[]; remove?: readonly string[] }, _options = {}): DirectoryUserConfig {
    return update({ patch: {} }, { transform: (current, saved) => {
      const protectedRoots = new Set(distinct([current.sitesHome, ...(policy.sourceRoots ?? [])]));
      const excluded = new Set(distinct(remove));
      return { siteRoots: distinct([...(saved.siteRoots ?? []), ...add]).filter((root) => !excluded.has(root) && !protectedRoots.has(root)) };
    } });
  }
  // A move journal is written before copying; the old name stays authoritative until verification
  // retires it. Recovery never guesses from two DB sizes/timestamps or asks users to delete data.
  function moveMarker(source: string, candidates: readonly string[]): { markerPath: string; target: string; backup: string } | undefined {
    const markerPath = source + ".home2-relocation.json", marker = fileAt(markerPath).read({});
    if (marker.state === "missing") return undefined;
    const value = marker.state === "ok" ? marker.value as { to?: unknown; backup?: unknown } | null : undefined;
    const target = value?.to, backup = markerBackup(source, value?.backup);
    if (typeof target !== "string" || !candidates.includes(target) || backup === undefined) throw invalidMarker(markerPath);
    return { markerPath, target, backup };
  }
  function authoritativeCopy(source: string, { markerPath, target, backup }: { markerPath: string; target: string; backup: string }): string {
    if (exists(source)) return source;
    if (exists(backup) && exists(target)) return target;
    throw new Error(`Interrupted database move needs recovery: ${markerPath}. Restore the pre-move backup before starting.`);
  }
  function recoveredMove(candidates: readonly string[]): string | undefined {
    for (const source of candidates) {
      const marker = moveMarker(source, candidates);
      if (!marker) continue;
      const authoritative = authoritativeCopy(source, marker);
      report(`Recovered interrupted database move using ${authoritative}. Keep the backup files (${marker.backup}); finish the move before changing database placement.`);
      return authoritative;
    }
    return undefined;
  }
  function existingCopy(candidates: readonly string[], filename: string): string | undefined {
    const present = candidates.filter(exists);
    if (present.length > 1) throw new Error(`Multiple copies of ${filename} exist for this site. Choose the authoritative database before starting it.`);
    return present[0];
  }
  function unsafeIdentityPath(legacy: string, placement: DirectoryUserConfig["databases"] | undefined): string {
    if (!placement && exists(legacy)) return legacy;
    throw new Error("A database directory requires a safe, stable site identity.");
  }
  function databasePath({ dir, id, filename, placement }: { dir: string; id: string; filename: string; placement?: DirectoryUserConfig["databases"] }, _options = {}): string {
    assertDatabaseFilename(filename);
    const inSite = path.join(dir, "data.nosync", filename), legacy = path.join(dir, filename);
    if (!SAFE_SITE_ID.test(id)) return unsafeIdentityPath(legacy, placement);
    const appData = path.join(directories.appData, "databases", id, filename);
    if (placement) return placement === "inSite" ? inSite : appData;
    const candidates = [legacy, inSite, appData];
    const found = recoveredMove(candidates) ?? existingCopy(candidates, filename);
    if (found) return found;
    // A missing chat DB follows an existing content DB even after the user changes preferences.
    if (filename !== "content.db") return path.join(path.dirname(databasePath({ dir, id, filename: "content.db" })), filename);
    return read({}).databases === "inSite" ? inSite : appData;
  }
  return { read, update, updateRoots, databasePath, filePath, ...directories,
    // Discovery/catalog callers list real old homes. Pointer normalization and creation admission
    // may inspect the supported spellings even before their directories have been created.
    legacyHomes: (_required: Record<string, never>, { includeMissing = false }: { includeMissing?: boolean } = {}) =>
      distinct(legacyHomes).filter((root) => includeMissing || (exists(root) && isDirectory(root))),
    defaultRoots: (_required: Record<string, never>, _options = {}) => distinct(policy.sourceRoots ?? []),
    extraRoots: (_required: Record<string, never>, _options = {}) => distinct(env[policy.rootsEnvName] !== undefined ? read({}).siteRoots : stored().siteRoots ?? []),
    roots: (_required: Record<string, never>, _options = {}) => {
      const config = read({}), parent = paths.dirname(config.sitesHome);
      // Discover only the selected home's existing former level. Scanning another old home
      // crosses the local/synced boundary and admits broad or absent roots at every boot.
      const formerRoots = legacyHomes.includes(parent) && exists(parent) && isDirectory(parent) ? [parent] : [];
      return distinct([config.sitesHome, ...formerRoots, ...(policy.sourceRoots ?? []), ...config.siteRoots]);
    },
    runningPath: ({ dir }: { dir: string }, _options = {}) => path.join(directories.appData, "running", createHash("sha256").update(canonicalPath({ path: dir })).digest("hex") + ".json"),
    syncWarning: (_required: Record<string, never>, _options = {}) => {
      const config = read({});
      const sync = syncProvider(config.sitesHome);
      if (!syncsDatabases(sync)) return null;
      return { provider: sync, message: config.databases === "appData" ? `${sync} syncs the sites folder. New databases use OS app-data for safety. Site folders are not self-contained: include their app-data databases when transferring them.` : `${sync} syncs the sites folder. It does not honor data.nosync; syncing live SQLite databases can corrupt them. Use app-data databases or a local sites folder.`, localHome };
    },
  };
}

const SETTING_RULES: readonly (readonly [key: keyof DirectoryUserConfig, valid: (value: unknown) => boolean, message: string])[] = [
  ["sitesHome", (value) => typeof value === "string" && Boolean(value.trim()), "sitesHome must name a directory."],
  ["siteRoots", (value) => Array.isArray(value) && value.every((root) => typeof root === "string" && root.trim()), "siteRoots must be an array of directory paths."],
  ["databases", (value) => value === "inSite" || value === "appData", 'databases must be "inSite" or "appData".'],
];
/** Validate only the three public settings; reject arrays, unknown fields and invalid enums.
 * @complexity O(n) root strings. No I/O or mutation.
 */
export function validateDirectoryUserConfig({ value }: { value: unknown }, _options = {}): Partial<DirectoryUserConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("User config must be an object.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !SETTING_RULES.some(([known]) => known === key))) throw new Error("Unknown user config setting.");
  for (const [key, valid, message] of SETTING_RULES) if (row[key] !== undefined && !valid(row[key])) throw new Error(message);
  return row as Partial<DirectoryUserConfig>;
}
