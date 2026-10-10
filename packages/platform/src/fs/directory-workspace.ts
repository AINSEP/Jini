import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDurableJsonFile, createNodeDurableJsonPorts, type DurableJsonPorts } from "./durable-json.js";
import { createDirectoryUserConfig, type DirectoryUserConfigPolicy, type DirectoryUserConfig } from "./directory-user-config.js";
import type { UserDirectoryOptions } from "./user-data-directories.js";
import { resolveDirectoryHome } from "./directory-home.js";
import { createDirectoryRegistry, type DirectoryRegistry } from "./directory-registry.js";
import { createDirectoryRunningLock } from "./directory-running-lock.js";

/** Node assembly only. Policy modules receive explicit filesystem, clock and process ports.
 * Settings live outside the selected home so changing the setting never loses the pointer.
 * Reading a missing home/catalog does not create it. Mutations use the durable JSON owner.
 * @complexity O(n) registry records, O(1) settings/lease operations.
 */
export function createNodeDirectoryWorkspace(
  { homeDir, defaultFolder, envName, settingsFile, registryName, runningName, userConfig }: {
    homeDir: string; defaultFolder: string; envName: string; settingsFile: string; registryName: string; runningName: string; userConfig?: DirectoryUserConfigPolicy;
  }, { env = process.env, cwd = process.cwd(), ports = createNodeDurableJsonPorts({}), canonicalPath = canonicalNodeDirectory, ...directoryOptions }: UserDirectoryOptions & { env?: NodeJS.ProcessEnv; cwd?: string; ports?: DurableJsonPorts; canonicalPath?: (required: { path: string }) => string } = {},
) {
  const fileAt = (filePath: string) => createDurableJsonFile({ ...ports, filePath, notices: {
    prefix: "Directory workspace", lockTimeout: ({ lockPath }) => `Timed out waiting for file lock: ${lockPath}`,
  } }, { staleMs: Infinity });
  const config = userConfig ? createDirectoryUserConfig({ homeDir, defaultFolder, envName, policy: userConfig,
    fileAt, canonicalPath, isDirectory: (file) => ports.filesystem.statSync(file).isDirectory(), exists: (file) => { try { ports.filesystem.statSync(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
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
  const atHome = () => createDirectoryRegistry({ file: fileAt(path.join(config?.appData ?? home(), registryName)), canonicalPath });
  // Read old catalogs without modifying sites. Import only under the settings lane on a mutation;
  // dry-run and startup discovery can inspect the old state without creating app-data files.
  const oldCatalogs = () => {
    if (!config || !userConfig?.legacySettingsFile) return [];
    const legacy = fileAt(userConfig.legacySettingsFile).read({});
    if (legacy.state === "unreadable") throw new Error("Legacy directory setting is unreadable; nothing was overwritten.");
    const oldHome = legacy.state === "ok" ? (legacy.value as { home?: unknown })?.home : path.join(homeDir, userConfig.legacyDefaultFolder ?? defaultFolder);
    if (typeof oldHome !== "string") throw new Error("Legacy directory setting has an invalid home.");
    return [...new Set([oldHome, home()])].map((root) => createDirectoryRegistry({ file: fileAt(path.join(root, registryName)), canonicalPath }));
  };
  const importOldCatalog = () => {
    const current = atHome();
    if (!config || current.hasMigration({ migration: "app-data-catalog-v1" })) return;
    const previous = oldCatalogs();
    current.merge({ entries: previous.flatMap((catalog) => catalog.list({})), migrations: previous.flatMap((catalog) => catalog.migrations({})), migration: "app-data-catalog-v1" });
  };
  const mutate = <T>(operation: () => T): T => settings.withLock({ critical: () => { importOldCatalog(); return operation(); } });
  // Serialize pointer changes with catalog mutations. A caller that obtained a registry before
  // settings changed must still write into the current home, never strand a late registration.
  const registry: DirectoryRegistry = {
    list: (required, options = {}) => {
      const current = atHome();
      if (!config || current.hasMigration({ migration: "app-data-catalog-v1" })) return current.list(required, options);
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
      const filePath = config?.runningPath({ dir }) ?? path.join(canonicalPath({ path: dir }), runningName);
      const current = createDirectoryRunningLock({ file: fileAt(filePath), isAlive: ports.process.isAlive,
        remove: () => ports.filesystem.rmSync(filePath, { force: true }) }, { ...(ports.process.bootIdentity ? { bootIdentity: ports.process.bootIdentity } : {}) });
      if (!config) return current;
      const legacyPath = path.join(canonicalPath({ path: dir }), runningName);
      const legacy = createDirectoryRunningLock({ file: fileAt(legacyPath), isAlive: ports.process.isAlive,
        remove: () => ports.filesystem.rmSync(legacyPath, { force: true }) }, { ...(ports.process.bootIdentity ? { bootIdentity: ports.process.bootIdentity } : {}) });
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
    return { ...config.read({}), configPath: config.filePath, appData: config.appData, warning: config.syncWarning({}),
      overrides: { sitesHome: env[envName] !== undefined, siteRoots: env[userConfig!.rootsEnvName] !== undefined } };
  }
}

/** Canonicalize existing ancestors without creating the selected directory. */
function canonicalNodeDirectory({ path: dir }: { path: string }, _options = {}): string {
  try { return fs.realpathSync(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Resolve the nearest existing ancestor too: a not-yet-created home may sit below a
    // symlink (notably /var on macOS) and must compare equal before and after creation.
    const absolute = path.resolve(dir), parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(canonicalNodeDirectory({ path: parent }), path.basename(absolute));
  }
}
