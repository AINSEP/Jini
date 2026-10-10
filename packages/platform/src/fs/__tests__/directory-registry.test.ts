import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
