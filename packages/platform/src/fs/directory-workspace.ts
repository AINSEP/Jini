import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDurableJsonFile, createNodeDurableJsonPorts, type DurableJsonPorts, updateDurableJsonFiles, type DurableJsonChange } from "./durable-json.js";
import { createDirectoryUserConfig, type DirectoryUserConfigPolicy, type DirectoryUserConfig, validateDirectoryUserConfig } from "./directory-user-config.js";
import type { UserDirectoryOptions } from "./user-data-directories.js";
import { resolveDirectoryHome } from "./directory-home.js";
import { createDirectoryRegistry, type DirectoryRegistry } from "./directory-registry.js";
import { createDirectoryRunningLock } from "./directory-running-lock.js";
import { fallbackIfMissing } from "./errno.js";

/** Migration id recorded once the old per-app catalogs are merged into the shared registry. */
const APP_DATA_CATALOG_MIGRATION = "app-data-catalog-v1";

/** Node assembly only. Policy modules receive explicit filesystem, clock and process ports.
 * Settings live outside the selected home so changing the setting never loses the pointer.
 * Reading a missing home/catalog does not create it. Opt-in registry recovery may prune known
 * pollution on load; read-only hosts omit that policy. Mutations use the durable JSON owner.
 * @complexity O(n) registry records, O(1) settings/lease operations.
 */
export function createNodeDirectoryWorkspace(
  { homeDir, defaultFolder, envName, settingsFile, registryName, runningName, userConfig, registryRecovery }: {
    homeDir: string; defaultFolder: string; envName: string; settingsFile: string; registryName: string; runningName: string; userConfig?: DirectoryUserConfigPolicy;
    /** Opt-in host recovery of known test pollution; missing user directories alone never qualify. */
    registryRecovery?: { fixtureIdPattern: RegExp; temporaryRoots?: readonly string[] };
  }, { env = process.env, cwd = process.cwd(), ports = createNodeDurableJsonPorts({}), canonicalPath = canonicalNodeDirectory, ...directoryOptions }: UserDirectoryOptions & { env?: NodeJS.ProcessEnv; cwd?: string; ports?: DurableJsonPorts; canonicalPath?: (required: { path: string }) => string } = {},
) {
  const fileAt = (filePath: string) => createDurableJsonFile({ ...ports, filePath, notices: {
    prefix: "Directory workspace", lockTimeout: ({ lockPath }) => `Timed out waiting for file lock: ${lockPath}`,
  } }, { staleMs: Infinity });
  const config = userConfig ? createDirectoryUserConfig({ homeDir, defaultFolder, envName, policy: userConfig,
    fileAt, canonicalPath, removeFile: ({ filePath }) => ports.filesystem.rmSync(filePath, { force: true }), isDirectory: (file) => ports.filesystem.statSync(file).isDirectory(), exists: (file) => { try { ports.filesystem.statSync(file); return true; } catch (error) { return fallbackIfMissing(error, false); } },
  }, { env, cwd, report: (message) => ports.report.error({ message }), ...directoryOptions }) : undefined;
  const settings = fileAt(config?.filePath ?? settingsFile);
  function readSetting(): string | undefined {
    const read = settings.read({});
    if (read.state === "missing") return undefined;
    if (read.state !== "ok" || typeof (read.value as { home?: unknown } | null)?.home !== "string") throw new Error("The directory home setting is unreadable.");
    return (read.value as { home: string }).home;
  }
  const legacyHome = () => canonicalPath({ path: resolveDirectoryHome({ homeDir, defaultFolder, envName, env, setting: env[envName] === undefined ? readSetting() : undefined }, { cwd }) });
  const home = () => config?.read({}).sitesHome ?? legacyHome();
  const fixturePattern = registryRecovery ? new RegExp(registryRecovery.fixtureIdPattern.source, registryRecovery.fixtureIdPattern.flags.replace(/[gy]/g, "")) : undefined;
  const atHome = () => createDirectoryRegistry({ file: fileAt(path.join(config?.appData ?? home(), registryName)), canonicalPath }, registryRecovery ? {
    discard: ({ entry }) => {
      const absolute = canonicalPath({ path: entry.path });
      // HOME may itself be under tmp (desktop E2E), and a selected sites home may live there.
      // Neither is pollution, including temporarily unavailable descendants and symlink aliases.
      const protectedPath = [homeDir, home()].some((root) => {
        const relative = path.relative(canonicalPath({ path: root }), absolute);
        return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
      });
      if (protectedPath) return false;
      const temporary = (registryRecovery.temporaryRoots ?? ["/private/tmp", "/tmp", os.tmpdir()]).some((root) => {
        const relative = path.relative(canonicalPath({ path: root }), absolute);
        return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
      });
      if (!temporary && !fixturePattern!.test(entry.id)) return false;
      // A live temp-path folder is a real site. Only ENOENT proves this candidate is stale.
      try { ports.filesystem.statSync(entry.path); return false; }
      catch (error) { return fallbackIfMissing(error, true); }
    },
    reportDiscarded: ({ entries }) => ports.report.error({ message: `Directory workspace: removed ${entries.length} test/temporary catalog entries: ${entries.map((entry) => entry.id).join(", ")}` }),
  } : {});
  // Read old catalogs without modifying sites. Import only under the settings lane on a mutation;
  // dry-run and startup discovery can inspect the old state without creating app-data files.
  const oldCatalogs = () => {
    // An explicit host profile is an isolation boundary. Importing HOME's legacy settings/catalog
    // would silently enroll the owner's sites (and potentially read real app-data) into QA profiles.
    if (directoryOptions.appDataDir !== undefined) return [];
    if (!config || !userConfig?.legacySettingsFile) return [];
    const legacy = fileAt(userConfig.legacySettingsFile).read({});
    if (legacy.state === "unreadable") throw new Error("Legacy directory setting is unreadable; nothing was overwritten.");
    const oldHome = legacy.state === "ok" ? (legacy.value as { home?: unknown })?.home : path.join(homeDir, userConfig.legacyDefaultFolder ?? defaultFolder);
    if (typeof oldHome !== "string") throw new Error("Legacy directory setting has an invalid home.");
    // Legacy settings use the same home shorthand contract; current overrides must not redirect the import.
    const expandedHome = resolveDirectoryHome({ homeDir, defaultFolder, envName, env: {}, setting: oldHome }, { cwd, ...directoryOptions });
    return [...new Set([expandedHome, ...config.legacyHomes({}), home()])].map((root) => createDirectoryRegistry({ file: fileAt(path.join(root, registryName)), canonicalPath }));
  };
  const importOldCatalog = () => {
    const current = atHome();
    if (!config || current.hasMigration({ migration: APP_DATA_CATALOG_MIGRATION })) return;
    const previous = oldCatalogs();
    current.merge({ entries: previous.flatMap((catalog) => catalog.list({})), migrations: previous.flatMap((catalog) => catalog.migrations({})), migration: APP_DATA_CATALOG_MIGRATION });
  };
  // One lease adapter for both the app-data and the site-local (legacy) lease locations.
  const runningLockAt = (filePath: string) => createDirectoryRunningLock({ file: fileAt(filePath), isAlive: ports.process.isAlive,
    remove: () => ports.filesystem.rmSync(filePath, { force: true }) }, { ...(ports.process.bootIdentity ? { bootIdentity: ports.process.bootIdentity } : {}) });
  const mutate = <T>(operation: () => T): T => settings.withLock({ critical: () => { importOldCatalog(); return operation(); } });
  // Serialize pointer changes with catalog mutations. A caller that obtained a registry before
  // settings changed must still write into the current home, never strand a late registration.
  const registry: DirectoryRegistry = {
    list: (required, options = {}) => {
      const current = atHome();
      if (!config || current.hasMigration({ migration: APP_DATA_CATALOG_MIGRATION })) return current.list(required, options);
      const rows = [...oldCatalogs().flatMap((catalog) => catalog.list(required, options)), ...current.list(required, options)];
      return [...new Map(rows.map((row) => [canonicalPath({ path: row.path }), row])).values()];
    },
    hasMigration: (required, options = {}) => atHome().hasMigration(required, options),
    migrations: (required, options = {}) => atHome().migrations(required, options),
    merge: (required, options = {}) => mutate(() => atHome().merge(required, options)),
    opened: (required, options = {}) => mutate(() => atHome().opened(required, options)),
    remove: (required, options = {}) => mutate(() => atHome().remove(required, options)),
    relocate: (required, options = {}) => mutate(() => atHome().relocate(required, options)),
  };
  return {
    homeDir,
    config: (_required: Record<string, never>, _options = {}) => thisConfig(),
    updateConfig: (required: { patch: Partial<DirectoryUserConfig> }, options = {}) => {
      if (!config) throw new Error("User config policy is not configured.");
      config.update(required, options);
      return thisConfig();
    },
    updateRoots: (required: { add?: readonly string[]; remove?: readonly string[] }, options = {}) => {
      if (!config) throw new Error("User config policy is not configured.");
      config.updateRoots(required, options);
      return thisConfig();
    },
    roots: (_required: Record<string, never>, _options = {}) => config?.roots({}) ?? [home()],
    databasePath: (required: { dir: string; id: string; filename: string; placement?: DirectoryUserConfig["databases"] }, options = {}) => {
      if (!config) return path.join(required.dir, required.filename);
      return config.databasePath(required, options);
    },
    /** Only the implicit nested home may create its application parent below mounted Documents.
     * Custom homes still require their immediate parent, so an absent volume is never fabricated.
     */
    homeAvailable: (_required: Record<string, never>, _options = {}) => {
      const selected = home();
      const parent = config?.legacyHomes({}, { includeMissing: true }).includes(path.dirname(selected)) ? path.dirname(path.dirname(selected)) : path.dirname(selected);
      try { return ports.filesystem.statSync(parent).isDirectory(); }
      catch (error) { return fallbackIfMissing(error, false); }
    },
    legacyHomes: (_required: Record<string, never>, _options = {}) => config?.legacyHomes({}) ?? [],
    /** Commit a verified move's catalog and every injected path reference as one locked unit.
     * Uses the registry owner to preserve identity/collision rules; settings retain env precedence.
     * @complexity O(total catalog/reference bytes), with rollback snapshots in memory.
     */
    relocate({ from, to, entry, references = [] }: { from: string; to: string; entry: import("./directory-registry.js").DirectoryRecord; references?: readonly DurableJsonChange[] }, _options = {}) {
      if (!config) throw new Error("Relocation requires user config policy.");
      const repoint = (dir: string) => {
        const current = canonicalPath({ path: dir });
        if (current === path.dirname(home()) && config!.legacyHomes({}).includes(current)) return home();
        return current === from || current.startsWith(from + path.sep) ? path.join(to, path.relative(from, current)) : dir;
      };
      updateDurableJsonFiles({ fileAt, remove: ({ filePath }) => ports.filesystem.rmSync(filePath, { force: true }), changes: [
        { filePath: config.filePath, transform: (value) => {
          if (value === undefined) return undefined;
          const saved = validateDirectoryUserConfig({ value });
          // Persist only the saved pointer's nesting transition. Environment overrides belong
          // to this process and must never become another host's permanent configuration.
          const savedHome = saved.sitesHome === undefined ? undefined : resolveDirectoryHome({ homeDir, defaultFolder, envName, env: {}, setting: saved.sitesHome }, { cwd, ...(directoryOptions.platform ? { platform: directoryOptions.platform } : {}) });
          const paths = directoryOptions.platform === "win32" ? path.win32 : path;
          return { ...saved, ...(saved.sitesHome && savedHome && config.legacyHomes({}, { includeMissing: true }).includes(canonicalPath({ path: savedHome })) ? { sitesHome: paths.join(saved.sitesHome, userConfig!.defaultSubfolder!) } : {}),
            ...(saved.siteRoots ? { siteRoots: [...new Set(saved.siteRoots.map(repoint))] } : {}) };
        } },
        { filePath: path.join(config.appData, registryName), transform: (value) => {
          // A transaction-local file adapter lets the registry's existing validation and merge
          // own this schema without re-acquiring the physical lock already held above.
          let state = value;
          const staged = createDirectoryRegistry({ canonicalPath, file: {
            read: () => state === undefined ? { state: "missing" } : { state: "ok", value: state },
            write: ({ value: next }) => { state = next; }, withLock: ({ critical }) => critical(),
          } });
          if (!staged.hasMigration({ migration: APP_DATA_CATALOG_MIGRATION })) {
            const previous = oldCatalogs();
            staged.merge({ entries: previous.flatMap((catalog) => catalog.list({})), migrations: previous.flatMap((catalog) => catalog.migrations({})), migration: APP_DATA_CATALOG_MIGRATION });
          }
          const existing = staged.list({}).find((row) => row.path === from || row.id === entry.id);
          if (existing && existing.path !== from && existing.path !== to) throw new Error("Site identity is registered at an unrelated path.");
          if (!existing) staged.merge({ entries: [{ ...entry, path: from }] });
          staged.relocate({ from, to });
          return state;
        } }, ...references,
      ] });
    },
    home: (_required: Record<string, never>, _options = {}) => home(),
    setHome({ path: dir }: { path: string }, _options = {}) {
      if (env[envName] !== undefined) throw new Error(`${envName} overrides this setting. Unset it before changing the directory home.`);
      if (config) { config.update({ patch: { sitesHome: dir } }); return home(); }
      const selected = canonicalPath({ path: resolveDirectoryHome({ homeDir, defaultFolder, envName, env: {}, setting: dir }, { cwd }) });
      settings.withLock({ critical: () => {
        const previous = createDirectoryRegistry({ file: fileAt(path.join(home(), registryName)), canonicalPath });
        const target = createDirectoryRegistry({ file: fileAt(path.join(selected, registryName)), canonicalPath });
        target.merge({ entries: previous.list({}), migrations: previous.migrations({}) });
        settings.write({ value: { home: selected } });
      } });
      return home();
    },
    registry: (_required: Record<string, never>, _options = {}) => registry,
    running: ({ path: dir }: { path: string }, _options = {}) => {
      const legacyPath = path.join(canonicalPath({ path: dir }), runningName);
      const current = runningLockAt(config?.runningPath({ dir }) ?? legacyPath);
      if (!config) return current;
      // The legacy lease is only ever peeked, so its removal callback is never invoked here.
      const legacy = runningLockAt(legacyPath);
      return { ...current,
        // Older servers may still own a site-local lease. Observe it without moving/editing it;
        // claim serializes against new clients and refuses the old live owner.
        peek: (_required: Record<string, never>, _options = {}) => legacy.peek({}) ?? current.peek({}),
        read: (_required: Record<string, never>, _options = {}) => legacy.peek({}) ?? current.read({}),
        claim: (required: Parameters<typeof current.claim>[0], options = {}) => settings.withLock({ critical: () => {
          const existing = legacy.peek({});
          if (existing) return { acquired: false, record: existing };
          return current.claim(required, options);
        } }),
      };
    },
    claim({ path: dir, app, port = 0, scheme = "http" }: { path: string; app: string; port?: number; scheme?: "http" | "https" }, _options = {}) {
      const lock = this.running({ path: dir });
      return lock.claim({ record: { pid: ports.process.pid, port, app, scheme, started: new Date(ports.clock.nowMs()).toISOString(), token: randomUUID() } });
    },
  };
  function thisConfig() {
    if (!config) throw new Error("User config policy is not configured.");
    return { ...config.read({}), defaultRoots: config.defaultRoots({}), extraRoots: config.extraRoots({}), configPath: config.filePath, appData: config.appData, warning: config.syncWarning({}),
      overrides: { sitesHome: env[envName] !== undefined, siteRoots: env[userConfig!.rootsEnvName] !== undefined } };
  }
}

/** Canonicalize existing ancestors without creating the selected directory.
 * The default canonicalizer of {@link createNodeDirectoryWorkspace}. `realpath` is the native
 * resolver by default; it is injectable so a missing filesystem root (an unmounted Windows drive)
 * can be exercised on any host. A missing root resolves to its absolute form.
 * @complexity O(d) realpath probes for d path segments.
 */
export function canonicalNodeDirectory({ path: dir }: { path: string }, { realpath = fs.realpathSync }: { realpath?: (dir: string) => string } = {}): string {
  try { return realpath(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Resolve the nearest existing ancestor too: a not-yet-created home may sit below a
    // symlink (notably /var on macOS) and must compare equal before and after creation.
    const absolute = path.resolve(dir), parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(canonicalNodeDirectory({ path: parent }, { realpath }), path.basename(absolute));
  }
}
