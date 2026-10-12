import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeDirectoryWorkspace } from "../directory-workspace.js";
import { createNodeDurableJsonPorts } from "../durable-json.js";
import { resolveUserDataDirectories } from "../user-data-directories.js";

describe("host-selected app-data profile", () => {
  it.each(["", " ", "relative/profile"])("rejects an unresolved profile path %j before reading OS configuration", (appDataDir) => {
    expect(() => resolveUserDataDirectories({ homeDir: "/users/owner", appName: "Example" }, {
      platform: "linux", env: {}, appDataDir, readText: () => { throw new Error("must validate before I/O"); },
    })).toThrow("appDataDir must be an absolute profile directory.");
  });
  it.each(["darwin", "linux", "win32"] as const)("uses the supplied directory on %s without appending the app name", (platform) => {
    const appDataDir = platform === "win32" ? "D:\\scratch\\profile" : "/scratch/profile";
    const required = { homeDir: platform === "win32" ? "C:\\Users\\owner" : "/users/owner", appName: "Example" };
    const options = { platform, env: {}, windowsDocuments: () => undefined, readText: () => undefined };
    const baseline = resolveUserDataDirectories(required, options);
    const selected = resolveUserDataDirectories(required, { ...options, appDataDir });
    expect(selected.appData).toBe(appDataDir);
    expect(selected.appData).not.toBe(baseline.appData);
    expect(selected.documents).toBe(baseline.documents);
    // Only the injected profile changes; the host's Documents policy retains the same result.
  });

  it("keeps config, catalog, database paths and leases in the profile without reading real app-data or legacy settings", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "app-data-profile-")));
    try {
      const appDataDir = path.join(root, "scratch"), real = path.join(root, "Library", "Application Support", "Example");
      const legacySettingsFile = path.join(root, ".example", "home.json"), site = path.join(root, "site");
      fs.mkdirSync(real, { recursive: true }); fs.mkdirSync(path.dirname(legacySettingsFile), { recursive: true }); fs.mkdirSync(site);
      fs.writeFileSync(path.join(real, "config.json"), '{"sitesHome":"/owner-only","databases":"appData"}');
      fs.writeFileSync(legacySettingsFile, JSON.stringify({ home: real }));
      fs.writeFileSync(path.join(real, "catalog.json"), "owner catalog must never be read");
      const ports = createNodeDurableJsonPorts({}), accessed: string[] = [];
      // Observe the existing filesystem port instead of mocking modules or using the real owner HOME.
      const filesystem = new Proxy(ports.filesystem, { get(target, key) {
        const method = Reflect.get(target, key);
        return typeof method !== "function" ? method : (...args: unknown[]) => {
          if (typeof args[0] === "string") accessed.push(args[0]);
          return Reflect.apply(method, target, args);
        };
      } });
      const make = () => createNodeDirectoryWorkspace({ homeDir: root, defaultFolder: "Project", envName: "PROJECT_HOME",
        settingsFile: legacySettingsFile, registryName: "catalog.json", runningName: ".running.json",
        userConfig: { appName: "Example", rootsEnvName: "PROJECT_ROOTS", legacySettingsFile },
      }, { platform: "darwin", env: {}, appDataDir, ports: { ...ports, filesystem } });
      const workspace = make();
      expect(workspace.config({}).configPath).toBe(path.join(appDataDir, "config.json"));
      expect(workspace.registry({}).list({})).toEqual([]);
      workspace.updateConfig({ patch: { sitesHome: site, siteRoots: [site], databases: "appData" } });
      workspace.registry({}).merge({ entries: [{ id: "alpha", name: "Alpha", path: site, createdBy: "test", lastOpened: null }] });
      const claim = workspace.claim({ path: site, app: "Test", port: 3456 });
      expect(claim.acquired).toBe(true);
      expect(make().config({}).sitesHome).toBe(site);
      expect(make().registry({}).list({})[0]?.id).toBe("alpha");
      expect(workspace.databasePath({ dir: site, id: "alpha", filename: "content.db" })).toBe(path.join(appDataDir, "databases", "alpha", "content.db"));
      expect(fs.readdirSync(path.join(appDataDir, "running")).filter((name) => name.endsWith(".json"))).toHaveLength(1);
      workspace.running({ path: site }).release({ token: claim.record.token });
      expect(accessed.some((file) => file === real || file.startsWith(real + path.sep) || file === legacySettingsFile)).toBe(false);
      expect(fs.readFileSync(path.join(real, "catalog.json"), "utf8")).toBe("owner catalog must never be read");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
