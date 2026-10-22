import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createNodeDurableJsonPorts } from "../durable-json.js";
import { createNodeDirectoryWorkspace } from "../directory-workspace.js";

it("merges aliases, retains creator/lastOpened, and imports MRU only once", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-directory-registry-")));
  try {
    const workspace = createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Sites", envName: "SITES_HOME", settingsFile: path.join(root, "setting.json"), registryName: "sites.json", runningName: "running.json" }, { env: {} });
    const real = path.join(root, "outside"), alias = path.join(root, "alias");
    fs.mkdirSync(real); fs.symlinkSync(real, alias);
    const registry = workspace.registry({});
    registry.merge({ entries: [{ id: "one", name: "One", path: real, createdBy: "Desktop", lastOpened: "2026-10-08T00:00:00.000Z" }] });
    registry.merge({ entries: [{ id: "alias-id", name: "Renamed", path: alias, createdBy: "Web", lastOpened: null }], migration: "mru" });
    expect(registry.list({})).toEqual([{ id: "one", name: "Renamed", path: real, createdBy: "Desktop", lastOpened: "2026-10-08T00:00:00.000Z" }]);
    registry.merge({ entries: [{ id: "ignored", name: "Ignored", path: root, createdBy: "old", lastOpened: null }], migration: "mru" });
    expect(registry.list({})).toHaveLength(1);
    expect(registry.hasMigration({ migration: "mru" })).toBe(true);
    expect(() => registry.merge({ entries: [{ id: "one", name: "Collision", path: root, createdBy: "Web", lastOpened: null }] })).toThrow("already registered at another path");
    const before = registry.list({});
    workspace.setHome({ path: path.join(root, "new-home") });
    expect(workspace.registry({}).list({})).toEqual(before);
    // A registry reference captured before the pointer change follows the new home for mutations.
    registry.opened({ path: real, at: "2026-10-09T00:00:00.000Z" });
    expect(workspace.registry({}).list({})[0]?.lastOpened).toBe("2026-10-09T00:00:00.000Z");
    fs.writeFileSync(path.join(workspace.home({}), "sites.json"), "torn");
    expect(() => workspace.registry({}).merge({ entries: [] })).toThrow("unreadable");
    expect(fs.readFileSync(path.join(workspace.home({}), "sites.json"), "utf8")).toBe("torn");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("concurrent processes cannot lose each other's registrations", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-directory-race-")));
  const config = { homeDir: root, defaultFolder: "Sites", envName: "SITES_HOME", settingsFile: path.join(root, "setting.json"), registryName: "sites.json", runningName: "running.json" };
  try {
    const moduleUrl = new URL("../directory-workspace.ts", import.meta.url).href;
    const run = (index: number) => new Promise<void>((resolve, reject) => {
      const source = `import { createNodeDirectoryWorkspace } from ${JSON.stringify(moduleUrl)}; const workspace = createNodeDirectoryWorkspace(${JSON.stringify(config)}, {env:{}}); for (let n=0;n<20;n++) workspace.registry({}).merge({entries:[{id:${JSON.stringify(String(index))}+":"+n,name:"Site",path:${JSON.stringify(root)}+"/"+${index}+"-"+n,createdBy:"worker",lastOpened:null}]});`;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe"] });
      let errors = ""; child.stderr.on("data", (chunk) => errors += chunk);
      child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errors || `worker exited ${code}`)));
    });
    await Promise.all([run(1), run(2), run(3)]);
    const rows = createNodeDirectoryWorkspace(config, { env: {} }).registry({}).list({});
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((row) => row.id)).size).toBe(60);
    expect(fs.readdirSync(path.join(root, "Sites"))).toEqual(["sites.json"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 30000);

it("canonicalizes a missing home below symlinked ancestors without creating it", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-home-alias-")));
  try {
    const real = path.join(root, "real"), alias = path.join(root, "alias");
    fs.mkdirSync(real); fs.symlinkSync(real, alias);
    const workspace = createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Sites", envName: "SITES_HOME", settingsFile: path.join(root, "setting.json"), registryName: "sites.json", runningName: "running.json" }, { env: { SITES_HOME: path.join(alias, "not-created", "Sites") } });
    expect(workspace.home({})).toBe(path.join(real, "not-created", "Sites"));
    expect(fs.existsSync(workspace.home({}))).toBe(false);
    expect(() => workspace.setHome({ path: root })).toThrow("SITES_HOME overrides this setting.");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


it("deskfx S4: load repair drops temporary/test pollution once and preserves missing user entries", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-catalog-repair-")));
  const notices: string[] = [];
  try {
    const fixtureTemp = path.join(root, "temp"); fs.mkdirSync(fixtureTemp);
    const homeDir = path.join(root, "home"); fs.mkdirSync(homeDir);
    const keep = path.join(root, "sites", "existing"); fs.mkdirSync(keep, { recursive: true });
    const workspace = createNodeDirectoryWorkspace({ homeDir, defaultFolder: "Sites", envName: "HOME_SITES",
      settingsFile: path.join(homeDir, "config.json"), registryName: "sites.json", runningName: "running.json",
      registryRecovery: { fixtureIdPattern: /^(?:minted-id|new-site-id)-\d+$/, temporaryRoots: [fixtureTemp] },
    }, { env: {}, ports: { ...createNodeDurableJsonPorts({}), report: { error: ({ message }) => notices.push(message) } } });
    const record = (id: string, dir: string) => ({ id, name: id, path: dir, createdBy: "Web", lastOpened: null });
    const kept = [record("user-missing", path.join(root, "offline", "real-site")), record("new-site-id-7777", keep), record("temp-neighbor", fixtureTemp + "-neighbor/site")];
    workspace.registry({}).merge({ entries: [...kept, record("minted-id-9999", path.join(fixtureTemp, "new-client")), record("new-site-id-1234", path.join(root, "sites", "new-client")), record("other-temp-id", path.join(fixtureTemp, "another"))] });
    expect(workspace.registry({}).list({})).toEqual(kept);
    expect(workspace.registry({}).list({})).toEqual(kept);
    expect(notices).toHaveLength(1); expect(notices[0]).toContain("removed 3");
    expect(JSON.parse(fs.readFileSync(path.join(workspace.home({}), "sites.json"), "utf8")).entries).toEqual(kept);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("deskfx S4: recovery is optional and cannot turn unreadable state into an empty catalog", () => {
  // The registry canonicalizes missing descendants too (/var -> /private/var on macOS).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "registry-fail-closed-")));
  try {
    const workspace = createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Sites", envName: "HOME_SITES", settingsFile: path.join(root, "setting.json"), registryName: "sites.json", runningName: "running.json" }, { env: {} });
    const row = { id: "new-site-id-1234", name: "Fixture", path: path.join(root, "absent"), createdBy: "test", lastOpened: null };
    workspace.registry({}).merge({ entries: [row] }); expect(workspace.registry({}).list({})).toEqual([row]);
    const file = path.join(workspace.home({}), "sites.json"); fs.writeFileSync(file, "broken");
    expect(() => workspace.registry({}).list({})).toThrow("unreadable"); expect(fs.readFileSync(file, "utf8")).toBe("broken");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


it("deskfx2 SHOULD-1: recovery retains existing temp sites and all home/sites-home paths", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-recovery-boundaries-")));
  try {
    const homeDir = path.join(root, "home"), sitesHome = path.join(root, "chosen-sites");
    fs.mkdirSync(homeDir); fs.mkdirSync(sitesHome);
    const temporary = path.join(root, "temporary"); fs.mkdirSync(temporary);
    const live = path.join(temporary, "live"); fs.mkdirSync(live);
    const alias = path.join(root, "alias-home"); fs.symlinkSync(homeDir, alias);
    const workspace = createNodeDirectoryWorkspace({ homeDir, defaultFolder: "Sites", envName: "HOME_SITES",
      settingsFile: path.join(homeDir, "settings.json"), registryName: "sites.json", runningName: "running.json",
      registryRecovery: { fixtureIdPattern: /^new-site-id-/, temporaryRoots: [root] },
    }, { env: { HOME_SITES: sitesHome } });
    const row = (id: string, dir: string) => ({ id, name: id, path: dir, createdBy: "test", lastOpened: null });
    const kept = [row("live-temp", live), row("new-site-id-home", path.join(homeDir, "missing")),
      row("new-site-id-sites", path.join(sitesHome, "missing")), row("new-site-id-alias", path.join(alias, "missing-other"))];
    workspace.registry({}).merge({ entries: [...kept, row("dead-temp", path.join(temporary, "missing"))] });
    expect(workspace.registry({}).list({})).toEqual(kept.map((entry) => ({ ...entry, path: entry.id === "new-site-id-alias" ? path.join(homeDir, "missing-other") : entry.path })));
    const catalog = path.join(sitesHome, "sites.json"), before = fs.readFileSync(catalog, "utf8");
    workspace.registry({}).list({}); expect(fs.readFileSync(catalog, "utf8")).toBe(before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("deskfx2 SHOULD-1: a stat error other than ENOENT never qualifies for pruning", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-recovery-stat-")));
  try {
    const candidate = path.join(root, "locked"), homeDir = path.join(root, "home"); fs.mkdirSync(homeDir);
    const ports = createNodeDurableJsonPorts({});
    const statSync = ((file: fs.PathLike, options?: fs.StatSyncOptions) => {
      if (file === candidate) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      return ports.filesystem.statSync(file, options);
    }) as typeof fs.statSync;
    const workspace = createNodeDirectoryWorkspace({ homeDir, defaultFolder: "Sites", envName: "SITES_HOME",
      settingsFile: path.join(homeDir, "settings.json"), registryName: "sites.json", runningName: "running.json",
      registryRecovery: { fixtureIdPattern: /^fixture$/, temporaryRoots: [root] },
    }, { env: {}, ports: { ...ports, filesystem: { ...ports.filesystem, statSync } } });
    workspace.registry({}).merge({ entries: [{ id: "fixture", name: "Locked", path: candidate, createdBy: "test", lastOpened: null }] });
    const catalog = path.join(workspace.home({}), "sites.json"), before = fs.readFileSync(catalog, "utf8");
    expect(() => workspace.registry({}).list({})).toThrow("permission denied");
    expect(fs.readFileSync(catalog, "utf8")).toBe(before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
