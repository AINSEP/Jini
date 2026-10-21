import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalNodeDirectory, createNodeDirectoryWorkspace } from "../directory-workspace.js";
import { createNodeDurableJsonPorts, type DurableJsonPorts } from "../durable-json.js";

// Real temporary directories plus hand-written port wrappers: the workspace is the Node assembly,
// so its observable contract is what lands on (or is refused from) disk.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function tempRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "directory-workspace-")));
  roots.push(root);
  return root;
}
const errno = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });
type Filesystem = DurableJsonPorts["filesystem"];
/** Wraps every filesystem method; `rewrite` may replace arguments or throw before the real call. */
function observedFilesystem(rewrite: (method: string, args: unknown[]) => unknown[]): Filesystem {
  const filesystem = createNodeDurableJsonPorts({}).filesystem;
  return new Proxy(filesystem, { get(target, key) {
    const method = Reflect.get(target, key);
    return typeof method !== "function" ? method : (...args: unknown[]) => Reflect.apply(method, target, rewrite(String(key), args));
  } });
}
/** statSync of `blocked` fails with `code`; every other call reaches the real filesystem. */
function statFailingAt(blocked: string, code: string): DurableJsonPorts {
  return { ...createNodeDurableJsonPorts({}), filesystem: observedFilesystem((method, args) => {
    if (method === "statSync" && args[0] === blocked) throw errno(code);
    return args;
  }) };
}
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const record = (id: string, dir: string) => ({ id, name: id, path: dir, createdBy: "test", lastOpened: null });

function plainWorkspace(root: string, options: Parameters<typeof createNodeDirectoryWorkspace>[1] = {}) {
  return createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Sites", envName: "SITES_HOME",
    settingsFile: path.join(root, "setting.json"), registryName: "sites.json", runningName: "running.json" }, { env: {}, ...options });
}
function nestedWorkspace(root: string, options: Parameters<typeof createNodeDirectoryWorkspace>[1] = {}) {
  return createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Product", envName: "PRODUCT_HOME",
    settingsFile: "unused", registryName: "catalog.json", runningName: ".running.json",
    userConfig: { appName: "Example", rootsEnvName: "PRODUCT_ROOTS", defaultSubfolder: "sites" },
  }, { env: {}, ...options });
}

describe("a workspace without a user config policy", () => {
  it("refuses config-only operations and serves its single home as roots and database location", () => {
    const root = tempRoot(), workspace = plainWorkspace(root);
    const policyMissing = "User config policy is not configured.";
    expect(() => workspace.config({})).toThrow(policyMissing);
    expect(() => workspace.updateConfig({ patch: { databases: "appData" } })).toThrow(policyMissing);
    expect(() => workspace.updateRoots({ add: [root] })).toThrow(policyMissing);
    expect(() => workspace.relocate({ from: path.join(root, "a"), to: path.join(root, "b"), entry: record("a", path.join(root, "a")) }))
      .toThrow("Relocation requires user config policy.");
    expect(workspace.roots({})).toEqual([path.join(root, "Sites")]);
    expect(workspace.legacyHomes({})).toEqual([]);
    expect(workspace.databasePath({ dir: path.join(root, "site"), id: "site", filename: "content.db" })).toBe(path.join(root, "site", "content.db"));
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("reports the home available only while its immediate parent exists", () => {
    const root = tempRoot();
    expect(plainWorkspace(root).homeAvailable({})).toBe(true);
    const detached = plainWorkspace(root, { env: { SITES_HOME: path.join(root, "volume", "Sites") } });
    expect(detached.homeAvailable({})).toBe(false);
    fs.mkdirSync(path.join(root, "volume"));
    expect(detached.homeAvailable({})).toBe(true);
    expect(fs.existsSync(detached.home({}))).toBe(false);
  });

  it("routes catalog removal, relocation and migration listing through the current home", () => {
    const root = tempRoot(), workspace = plainWorkspace(root), registry = workspace.registry({});
    const [alpha, beta, moved] = ["alpha", "beta", "moved"].map((name) => path.join(root, name));
    registry.merge({ entries: [record("alpha", alpha!), record("beta", beta!)], migration: "mru" });
    expect(registry.migrations({})).toEqual(["mru"]);
    registry.relocate({ from: alpha!, to: moved! });
    registry.remove({ path: beta! });
    expect(registry.list({})).toEqual([record("alpha", moved!)]);
    expect(readJson(path.join(root, "Sites", "sites.json"))).toMatchObject({ entries: [record("alpha", moved!)], migrations: ["mru"] });
  });

  it.each([["a non-string home", JSON.stringify({ home: 3 })], ["corrupt bytes", "not json"]])("fails closed on a home setting with %s, leaving it untouched", (_label, bytes) => {
    const root = tempRoot(), setting = path.join(root, "setting.json");
    fs.writeFileSync(setting, bytes);
    expect(() => plainWorkspace(root).home({})).toThrow("The directory home setting is unreadable.");
    expect(fs.readFileSync(setting, "utf8")).toBe(bytes);
  });

  it("surfaces a non-missing canonicalization failure instead of treating the home as absent", () => {
    const root = tempRoot(), file = path.join(root, "file.txt");
    fs.writeFileSync(file, "not a directory");
    expect(() => plainWorkspace(root, { env: { SITES_HOME: path.join(file, "Sites") } }).home({})).toThrow(expect.objectContaining({ code: "ENOTDIR" }));
  });

  it("names the contended settings lock when a live owner holds it past the wait budget", () => {
    const root = tempRoot(), lockPath = path.join(root, "setting.json.lock");
    let now = 0;
    // A live owner is never stale (staleMs is Infinity), so only the bounded wait can end this.
    const ports: DurableJsonPorts = { ...createNodeDurableJsonPorts({}), clock: { nowMs: () => now },
      sleep: { sleep: ({ durationMs }) => { now += durationMs; } }, process: { pid: process.pid, isAlive: () => true } };
    fs.writeFileSync(lockPath, "424242:held-by-another-process");
    expect(() => plainWorkspace(root, { ports }).setHome({ path: path.join(root, "next") })).toThrow(`Timed out waiting for file lock: ${lockPath}`);
    expect(now).toBeGreaterThanOrEqual(5000);
    expect(fs.existsSync(path.join(root, "setting.json"))).toBe(false);
    expect(fs.readFileSync(lockPath, "utf8")).toBe("424242:held-by-another-process");
  });

  it("claims and observes leases with a process port that has no boot identity", () => {
    const root = tempRoot(), site = path.join(root, "site"); fs.mkdirSync(site);
    const ports: DurableJsonPorts = { ...createNodeDurableJsonPorts({}), process: { pid: 4242, isAlive: ({ pid }) => pid === 4242 } };
    const workspace = plainWorkspace(root, { ports });
    const claim = workspace.claim({ path: site, app: "Web", port: 3000 });
    expect(claim).toMatchObject({ acquired: true, record: { pid: 4242, app: "Web", port: 3000, scheme: "http" } });
    expect(claim.record).not.toHaveProperty("bootId");
    expect(workspace.running({ path: site }).peek({})?.token).toBe(claim.record.token);
    workspace.running({ path: site }).release({ token: claim.record.token });
    expect(fs.existsSync(path.join(site, "running.json"))).toBe(false);
  });
});

describe("canonicalNodeDirectory", () => {
  const missing = () => { throw errno("ENOENT"); };
  it("keeps the absolute form when even the filesystem root is unavailable (an unmounted volume)", () => {
    expect(canonicalNodeDirectory({ path: "/volume/projects/site" }, { realpath: missing })).toBe("/volume/projects/site");
  });
  it("resolves the nearest existing ancestor and appends the missing descendants", () => {
    const realpath = (dir: string) => { if (dir === "/alias") return "/real"; throw errno("ENOENT"); };
    expect(canonicalNodeDirectory({ path: "/alias/new/site" }, { realpath })).toBe("/real/new/site");
  });
  it("propagates permission failures rather than guessing a canonical path", () => {
    expect(() => canonicalNodeDirectory({ path: "/locked/site" }, { realpath: () => { throw errno("EACCES"); } })).toThrow("EACCES");
  });
});

describe("opt-in registry recovery", () => {
  it("defaults the temporary roots to the OS temp directory and keeps live and protected entries", () => {
    const root = tempRoot(), homeDir = path.join(root, "home"), live = path.join(root, "live"), notices: string[] = [];
    fs.mkdirSync(homeDir); fs.mkdirSync(live);
    const ports = { ...createNodeDurableJsonPorts({}), report: { error: ({ message }: { message: string }) => { notices.push(message); } } };
    const workspace = createNodeDirectoryWorkspace({ homeDir, defaultFolder: "Sites", envName: "SITES_HOME",
      settingsFile: path.join(homeDir, "setting.json"), registryName: "sites.json", runningName: "running.json",
      registryRecovery: { fixtureIdPattern: /^fixture-\d+$/g },
    }, { env: {}, ports });
    const kept = [record("live-temp", live), record("home-missing", path.join(homeDir, "offline"))];
    workspace.registry({}).merge({ entries: [...kept, record("stale-temp", path.join(root, "gone"))] });
    expect(workspace.registry({}).list({})).toEqual(kept);
    expect(notices).toEqual(["Directory workspace: removed 1 test/temporary catalog entries: stale-temp"]);
  });
});

describe("legacy home settings import", () => {
  function legacyWorkspace(root: string, legacySettingsFile: string) {
    return createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Project", envName: "PROJECT_HOME",
      settingsFile: legacySettingsFile, registryName: "catalog.json", runningName: ".running.json",
      userConfig: { appName: "Example", rootsEnvName: "PROJECT_ROOTS", legacySettingsFile },
    }, { env: {}, platform: "linux", readText: () => undefined });
  }
  it("imports the default-folder catalog when the legacy setting was never written", () => {
    const root = tempRoot(), legacySettingsFile = path.join(root, "old-settings.json"), site = path.join(root, "Project", "alpha");
    fs.mkdirSync(site, { recursive: true });
    plainWorkspace(root, {}).registry({});
    createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Project", envName: "PROJECT_HOME", settingsFile: legacySettingsFile,
      registryName: "catalog.json", runningName: ".running.json" }, { env: {} }).registry({}).merge({ entries: [record("alpha", site)] });
    expect(fs.existsSync(legacySettingsFile)).toBe(false);
    expect(legacyWorkspace(root, legacySettingsFile).registry({}).list({})).toEqual([record("alpha", site)]);
  });
  it.each([
    ["corrupt bytes", "not json", "Legacy directory setting is unreadable; nothing was overwritten."],
    ["a non-string home", JSON.stringify({ home: 7 }), "Legacy directory setting has an invalid home."],
  ])("refuses to import from a legacy setting with %s", (_label, bytes, message) => {
    const root = tempRoot(), legacySettingsFile = path.join(root, "old-settings.json");
    fs.writeFileSync(legacySettingsFile, bytes);
    const workspace = legacyWorkspace(root, legacySettingsFile);
    expect(() => workspace.registry({}).list({})).toThrow(message);
    expect(() => workspace.registry({}).merge({ entries: [record("alpha", path.join(root, "alpha"))] })).toThrow(message);
    expect(fs.readFileSync(legacySettingsFile, "utf8")).toBe(bytes);
    expect(fs.existsSync(path.join(workspace.config({}).appData, "catalog.json"))).toBe(false);
  });
});

describe("config policy filesystem boundaries", () => {
  it("propagates a non-missing stat failure while discovering legacy homes", () => {
    const root = tempRoot(), blocked = path.join(root, "Product");
    expect(() => nestedWorkspace(root, { ports: statFailingAt(blocked, "EACCES") }).legacyHomes({})).toThrow("EACCES");
    expect(nestedWorkspace(root).legacyHomes({})).toEqual([]);
  });
  it("checks a custom home's own parent and propagates non-missing stat failures", () => {
    const root = tempRoot(), parent = path.join(root, "custom");
    nestedWorkspace(root).updateConfig({ patch: { sitesHome: path.join(parent, "home") } });
    expect(nestedWorkspace(root).homeAvailable({})).toBe(false);
    fs.mkdirSync(parent);
    expect(nestedWorkspace(root).homeAvailable({})).toBe(true);
    expect(() => nestedWorkspace(root, { ports: statFailingAt(parent, "EACCES") }).homeAvailable({})).toThrow("EACCES");
  });
  it("removes the config file again when the final extra root is removed and nothing else was saved", () => {
    const root = tempRoot(), workspace = nestedWorkspace(root), extra = path.join(root, "extra");
    workspace.updateRoots({ add: [extra] });
    expect(readJson(workspace.config({}).configPath)).toEqual({ siteRoots: [extra] });
    workspace.updateRoots({ remove: [extra] });
    expect(fs.existsSync(workspace.config({}).configPath)).toBe(false);
    expect(workspace.config({}).extraRoots).toEqual([]);
  });
});

describe("relocate", () => {
  const entry = (root: string) => record("move-id", path.join(root, "from"));
  const catalog = (workspace: ReturnType<typeof nestedWorkspace>) => path.join(workspace.config({}).appData, "catalog.json");

  for (const legacyExists of [true, false]) it(`repoints saved roots below the source${legacyExists ? " and the existing old default home" : ""} without a platform override`, () => {
    const root = tempRoot(), workspace = nestedWorkspace(root), from = path.join(root, "from"), to = path.join(root, "to");
    const oldDefault = path.join(root, "Documents", "Product"), unrelated = path.join(root, "unrelated");
    if (legacyExists) fs.mkdirSync(oldDefault, { recursive: true });
    const file = workspace.config({}).configPath; fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ sitesHome: oldDefault, siteRoots: [oldDefault, path.join(from, "child"), from, unrelated] }));
    workspace.relocate({ from, to, entry: entry(root) });
    // The saved old default pointer is nested even while missing; the old default *root* becomes
    // the nested home only while it is a real (existing) legacy home.
    expect(readJson(file)).toEqual({ sitesHome: path.join(oldDefault, "sites"), siteRoots: [legacyExists ? path.join(oldDefault, "sites") : oldDefault, path.join(to, "child"), to, unrelated] });
    expect(workspace.registry({}).list({})).toEqual([record("move-id", to)]);
  });

  it("leaves an absent config file absent while committing the catalog move", () => {
    const root = tempRoot(), workspace = nestedWorkspace(root), to = path.join(root, "to");
    workspace.relocate({ from: path.join(root, "from"), to, entry: entry(root) });
    expect(fs.existsSync(workspace.config({}).configPath)).toBe(false);
    expect(readJson(catalog(workspace))).toMatchObject({ entries: [record("move-id", to)] });
  });

  it("commits injected path references in the same unit, including a reference that deletes its file", () => {
    const root = tempRoot(), workspace = nestedWorkspace(root), to = path.join(root, "to");
    const pointer = path.join(root, "pointer.json"), stale = path.join(root, "stale.json");
    fs.writeFileSync(pointer, JSON.stringify({ site: path.join(root, "from") })); fs.writeFileSync(stale, "{}");
    workspace.updateRoots({ add: [path.join(root, "from", "child")] });
    workspace.relocate({ from: path.join(root, "from"), to, entry: entry(root), references: [
      { filePath: pointer, transform: () => ({ site: to }) }, { filePath: stale, transform: () => undefined },
    ] });
    expect(readJson(pointer)).toEqual({ site: to });
    expect(fs.existsSync(stale)).toBe(false);
    expect(readJson(workspace.config({}).configPath)).toEqual({ siteRoots: [path.join(to, "child")] });
    expect(workspace.registry({}).list({})).toEqual([record("move-id", to)]);
  });

  it("removes a freshly created catalog again when a later reference write fails", () => {
    const root = tempRoot(), pointer = path.join(root, "z-pointer.json");
    fs.writeFileSync(pointer, JSON.stringify({ site: "old" }));
    // Catalog paths sort before the pointer, so the catalog is written first and must be rolled back.
    let failures = 0;
    const ports: DurableJsonPorts = { ...createNodeDurableJsonPorts({}), filesystem: observedFilesystem((method, args) => {
      if (method === "renameSync" && args[1] === pointer && failures++ === 0) throw errno("EIO");
      return args;
    }) };
    const workspace = nestedWorkspace(root, { ports });
    expect(() => workspace.relocate({ from: path.join(root, "from"), to: path.join(root, "to"), entry: entry(root), references: [
      { filePath: pointer, transform: () => ({ site: "new" }) },
    ] })).toThrow("EIO");
    expect(fs.existsSync(catalog(workspace))).toBe(false);
    expect(readJson(pointer)).toEqual({ site: "old" });
  });

  it("moves an already-registered source in place rather than duplicating it", () => {
    const root = tempRoot(), workspace = nestedWorkspace(root), from = path.join(root, "from"), to = path.join(root, "to");
    workspace.registry({}).merge({ entries: [record("original-id", from)] });
    workspace.relocate({ from, to, entry: entry(root) });
    expect(workspace.registry({}).list({})).toEqual([record("original-id", to)]);
  });

  it.each([
    ["an unrelated path", "elsewhere", "Site identity is registered at an unrelated path."],
    // The registry, not the identity check, refuses a destination that is already registered.
    ["the destination", "to", "Relocation would overwrite a registered directory."],
  ])("rolls back every file when the site identity is already registered at %s", (_label, at, message) => {
    const root = tempRoot(), workspace = nestedWorkspace(root);
    workspace.updateRoots({ add: [path.join(root, "from", "child")] });
    workspace.registry({}).merge({ entries: [record("move-id", path.join(root, at))] });
    const before = [fs.readFileSync(workspace.config({}).configPath, "utf8"), fs.readFileSync(catalog(workspace), "utf8")];
    expect(() => workspace.relocate({ from: path.join(root, "from"), to: path.join(root, "to"), entry: entry(root) })).toThrow(message);
    expect([fs.readFileSync(workspace.config({}).configPath, "utf8"), fs.readFileSync(catalog(workspace), "utf8")]).toEqual(before);
  });

  it("nests a saved Windows default home with Windows separators", () => {
    // Windows-shaped paths are mapped onto a real temporary directory by the filesystem port, so
    // the durable writes and locks run for real while every path the workspace sees is C:\-rooted.
    const root = tempRoot();
    const toHost = (value: unknown) => typeof value === "string" && /^[A-Za-z]:\\/.test(value)
      ? path.join(root, value[0]!, ...value.slice(3).split(/[\\/]+/)) : value;
    const ports: DurableJsonPorts = { ...createNodeDurableJsonPorts({}), filesystem: observedFilesystem((_method, args) => args.map(toHost)) };
    const workspace = createNodeDirectoryWorkspace({ homeDir: "C:\\Users\\a", defaultFolder: "Product", envName: "PRODUCT_HOME",
      settingsFile: "unused", registryName: "catalog.json", runningName: ".running.json",
      userConfig: { appName: "Example", rootsEnvName: "PRODUCT_ROOTS", defaultSubfolder: "sites" },
    }, { platform: "win32", env: { APPDATA: "C:\\Roaming" }, ports, canonicalPath: ({ path: value }) => path.win32.normalize(value),
      windowsDocuments: () => "C:\\Users\\a\\Documents", windowsOneDriveRoots: () => [], readText: () => undefined });
    const configFile = String(toHost(workspace.config({}).configPath));
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ sitesHome: "C:\\Users\\a\\Documents\\Product" }));
    workspace.relocate({ from: "C:\\Sites\\from", to: "C:\\Sites\\to", entry: record("move-id", "C:\\Sites\\from") });
    expect(readJson(configFile)).toEqual({ sitesHome: "C:\\Users\\a\\Documents\\Product\\sites" });
    expect(workspace.registry({}).list({})).toEqual([record("move-id", "C:\\Sites\\to")]);
  });
});

describe("leases with a user config policy", () => {
  it("reads the legacy site-local lease first and otherwise the app-data lease", () => {
    const root = tempRoot(), site = path.join(root, "site"); fs.mkdirSync(site);
    const legacy = createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Product", envName: "PRODUCT_HOME",
      settingsFile: path.join(root, "old.json"), registryName: "catalog.json", runningName: ".running.json" }, { env: {} });
    const workspace = nestedWorkspace(root);
    const current = workspace.claim({ path: site, app: "Desktop" });
    expect(workspace.running({ path: site }).read({})?.token).toBe(current.record.token);
    workspace.running({ path: site }).release({ token: current.record.token });
    const old = legacy.claim({ path: site, app: "Old Web" });
    expect(workspace.running({ path: site }).read({})?.token).toBe(old.record.token);
    expect(workspace.claim({ path: site, app: "Desktop" })).toMatchObject({ acquired: false, record: { token: old.record.token } });
  });
});
