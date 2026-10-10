import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeDirectoryWorkspace } from "../directory-workspace.js";
import { resolveUserDataDirectories } from "../user-data-directories.js";
import { createDirectoryUserConfig } from "../directory-user-config.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "user-data-config-")));
  const make = (env: NodeJS.ProcessEnv = {}) => createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Project", envName: "PROJECT_HOME",
    settingsFile: path.join(root, "unused.json"), registryName: "catalog.json", runningName: ".running.json",
    userConfig: { appName: "Example", rootsEnvName: "PROJECT_ROOTS", sourceRoots: [path.join(root, "repo", "sites")] },
  }, { platform: "linux", env, cwd: root });
  return { root, make, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe("OS user directories without Electron", () => {
  it("uses Application Support on Mac and OS Documents", () => {
    expect(resolveUserDataDirectories({ homeDir: "/users/a", appName: "Example" }, { platform: "darwin", env: {} }))
      .toEqual({ appData: "/users/a/Library/Application Support/Example", documents: "/users/a/Documents" });
  });
  it("uses roaming app-data and redirected Windows Documents through an injected registry port", () => {
    expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\a", appName: "Example" }, { platform: "win32", env: { APPDATA: "D:\\Roaming", OneDrive: "E:\\Cloud" }, windowsDocuments: () => "%OneDrive%\\Documents" }))
      .toEqual({ appData: "D:\\Roaming\\Example", documents: "E:\\Cloud\\Documents" });
    expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\a", appName: "Example" }, { platform: "win32", env: {}, windowsDocuments: () => undefined }).documents).toBe("C:\\Users\\a\\Documents");
  });
  it("uses XDG data and localized user-dirs rather than executing shell text", () => {
    const reads: string[] = [];
    const result = resolveUserDataDirectories({ homeDir: "/users/a", appName: "Example" }, { platform: "linux", env: { XDG_DATA_HOME: "/data", XDG_CONFIG_HOME: "/config" }, readText: (file) => { reads.push(file); return 'XDG_DOCUMENTS_DIR="$HOME/Dokumente"'; } });
    expect(result).toEqual({ appData: "/data/Example", documents: "/users/a/Dokumente" }); expect(reads).toEqual(["/config/user-dirs.dirs"]);
    expect(resolveUserDataDirectories({ homeDir: "/users/a", appName: "Example" }, { platform: "linux", env: {}, readText: () => undefined }).appData).toBe("/users/a/.local/share/Example");
  });
});

describe("one durable user config", () => {
  it("reads defaults without writes, shares saved config, then applies per-field env precedence", () => {
    const f = fixture();
    try {
      const workspace = f.make();
      expect(workspace.home({})).toBe(path.join(f.root, "Documents", "Project"));
      expect(workspace.config({}).databases).toBe("inSite");
      expect(fs.existsSync(workspace.config({}).appData)).toBe(false);
      workspace.updateConfig({ patch: { sitesHome: "~/saved", siteRoots: ["~/extra"], databases: "appData" } });
      expect(f.make().config({})).toMatchObject({ sitesHome: path.join(f.root, "saved"), siteRoots: [path.join(f.root, "extra")], databases: "appData" });
      const override = f.make({ PROJECT_HOME: "~/env", PROJECT_ROOTS: "~/one, ~/two" });
      expect(override.config({})).toMatchObject({ sitesHome: path.join(f.root, "env"), siteRoots: [path.join(f.root, "one"), path.join(f.root, "two")], databases: "appData" });
      expect(() => override.setHome({ path: "/ignored" })).toThrow("PROJECT_HOME overrides this setting. Unset it before changing the directory home.");
      expect(() => override.updateConfig({ patch: { siteRoots: [] } })).toThrow("PROJECT_ROOTS overrides this setting. Unset it before changing site roots.");
      override.updateConfig({ patch: { databases: "inSite" } });
      expect(f.make().config({}).sitesHome).toBe(path.join(f.root, "saved"));
      expect(f.make({ PROJECT_ROOTS: "" }).config({}).siteRoots).toEqual([]);
      expect(() => f.make({ PROJECT_HOME: "" }).home({})).toThrow("PROJECT_HOME must name a directory");
    } finally { f.cleanup(); }
  });
  it("canonicalizes aliases, keeps nested roots, and preserves sibling writer changes", () => {
    const f = fixture();
    try {
      fs.mkdirSync(path.join(f.root, "real", "nested"), { recursive: true }); fs.symlinkSync(path.join(f.root, "real"), path.join(f.root, "alias"));
      f.make().updateConfig({ patch: { siteRoots: ["~/real", "~/alias", "~/real/nested"], databases: "appData" } });
      const second = f.make(); second.setHome({ path: "~/new" });
      expect(f.make().config({})).toMatchObject({ siteRoots: [path.join(f.root, "real"), path.join(f.root, "real", "nested")], databases: "appData", sitesHome: path.join(f.root, "new") });
      const bytes = fs.readFileSync(second.config({}).configPath, "utf8");
      expect(() => second.updateConfig({ patch: { databases: "invalid" as "inSite" } })).toThrow('databases must be "inSite" or "appData".');
      expect(fs.readFileSync(second.config({}).configPath, "utf8")).toBe(bytes);
    } finally { f.cleanup(); }
  });
  it("keeps boot available without mutating corrupt bytes, then quarantines before saving", () => {
    const f = fixture();
    try {
      const file = path.join(f.root, ".local", "share", "Example", "config.json"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "{broken");
      expect(f.make().config({}).databases).toBe("inSite");
      expect(fs.readFileSync(file, "utf8")).toBe("{broken");
      f.make().updateConfig({ patch: { databases: "appData" } });
      const backup = fs.readdirSync(path.dirname(file)).find((name) => name.startsWith("config.json.corrupt-"));
      expect(backup).toBeDefined(); expect(fs.readFileSync(path.join(path.dirname(file), backup!), "utf8")).toBe("{broken");
      expect(f.make().config({}).databases).toBe("appData");
    } finally { f.cleanup(); }
  });
  it("keeps catalog and leases in app-data while changing the home", () => {
    const f = fixture();
    try {
      const workspace = f.make(), dir = path.join(f.root, "external"); fs.mkdirSync(dir);
      workspace.registry({}).merge({ entries: [{ id: "alpha", name: "Alpha", path: dir, createdBy: "one", lastOpened: null }] });
      const claim = workspace.claim({ path: dir, app: "Web", port: 3456 });
      workspace.setHome({ path: "~/elsewhere" });
      expect(f.make().registry({}).list({})[0]?.path).toBe(dir);
      expect(f.make().running({ path: dir }).peek({})?.token).toBe(claim.record.token);
      expect(fs.existsSync(path.join(dir, ".running.json"))).toBe(false);
      expect(fs.existsSync(path.join(workspace.config({}).appData, "catalog.json"))).toBe(true);
      expect(fs.readdirSync(path.join(workspace.config({}).appData, "running")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
      workspace.running({ path: dir }).release({ token: claim.record.token });
    } finally { f.cleanup(); }
  });
});
it('incremental root writers reread inside the settings lock and preserve sibling fields', () => {
  const f = fixture();
  try {
    const first = f.make(), second = f.make(); second.config({});
    first.updateRoots({ add: ['~/one'] }); second.updateConfig({ patch: { databases: 'appData' } });
    second.updateRoots({ add: ['~/two', '~/one'] }); first.updateRoots({ remove: ['~/one'] });
    expect(f.make().config({})).toMatchObject({ siteRoots: [path.join(f.root, 'repo', 'sites'), path.join(f.root, 'two')], databases: 'appData' });
    const locked = f.make({ PROJECT_ROOTS: '~/env' });
    expect(() => locked.updateRoots({ add: ['~/three'] })).toThrow('PROJECT_ROOTS overrides this setting. Unset it before changing site roots.');
  } finally { f.cleanup(); }
});
it('imports the previous home catalog into app-data and observes old live leases without rewriting them', () => {
  const f = fixture();
  try {
    const legacyHome = path.join(f.root, 'Project Sites'), dir = path.join(legacyHome, 'alpha'); fs.mkdirSync(dir, { recursive: true });
    const settingsFile = path.join(f.root, 'old-settings.json');
    const policy = { homeDir: f.root, defaultFolder: 'Project Sites', envName: 'PROJECT_HOME', settingsFile, registryName: 'catalog.json', runningName: '.running.json' };
    const previous = createNodeDirectoryWorkspace(policy, { env: {}, cwd: f.root });
    previous.registry({}).merge({ entries: [{ id: 'alpha', name: 'Alpha', path: dir, createdBy: 'Web', lastOpened: null }] });
    const oldLease = previous.claim({ path: dir, app: 'Old Web', port: 3456 });
    const before = fs.readFileSync(path.join(dir, '.running.json'), 'utf8');
    const current = createNodeDirectoryWorkspace({ ...policy, defaultFolder: 'Project', userConfig: {
      appName: 'Example', rootsEnvName: 'PROJECT_ROOTS', legacySettingsFile: settingsFile, legacyDefaultFolder: 'Project Sites',
    } }, { env: {}, cwd: f.root, platform: 'linux' });
    expect(current.registry({}).list({})[0]?.path).toBe(dir);
    expect(current.claim({ path: dir, app: 'New Desktop' })).toMatchObject({ acquired: false, record: { token: oldLease.record.token } });
    expect(fs.readFileSync(path.join(dir, '.running.json'), 'utf8')).toBe(before);
    current.registry({}).opened({ path: dir, at: '2026-10-09T01:00:00Z' });
    expect(fs.existsSync(path.join(current.config({}).appData, 'catalog.json'))).toBe(true);
    current.setHome({ path: '~/next' }); expect(current.registry({}).list({})[0]?.path).toBe(dir);
    expect(fs.existsSync(path.join(legacyHome, 'catalog.json'))).toBe(true);
  } finally { f.cleanup(); }
});

it("defaults OneDrive-redirected Windows Documents to appData, retaining explicit inSite", () => {
  // In-memory ports keep simulated Windows paths off the host's POSIX filesystem. Canonical
  // containment uses Windows separators, matching the actual Windows assembly's native paths.
  let stored: JsonFileRead = { state: "missing" };
  const file: DurableJsonFile = { read: () => stored, tempPath: () => "unused", quarantine: () => false,
    write: ({ value }) => { stored = { state: "ok", value }; }, withLock: ({ critical }) => critical() };
  const config = createDirectoryUserConfig({ homeDir: "/fixture", defaultFolder: "Project", envName: "PROJECT_HOME",
    policy: { appName: "Example", rootsEnvName: "PROJECT_ROOTS" }, fileAt: () => file,
    canonicalPath: ({ path: value }) => path.win32.normalize(value), exists: () => false, isDirectory: () => true,
  }, { platform: "win32", env: { OneDrive: "/fixture/OneDrive", APPDATA: "/fixture/roaming" },
    windowsDocuments: () => "/fixture/OneDrive/Documents", readText: () => undefined, cwd: "/fixture" });
  expect(config.read({}).databases).toBe("appData");
  expect(config.syncWarning({})?.message).toBe("OneDrive syncs the sites folder. New databases use OS app-data for safety. Site folders are not self-contained: include their app-data databases when transferring them.");
  config.update({ patch: { databases: "inSite" } });
  expect(config.read({}).databases).toBe("inSite");
});
