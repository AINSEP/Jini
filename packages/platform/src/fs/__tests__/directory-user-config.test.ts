import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDirectoryUserConfig, validateDirectoryUserConfig, type DirectoryUserConfigPolicy } from "../directory-user-config.js";
import type { DurableJsonFile, JsonFileRead } from "../durable-json.js";

/** In-memory ports for the settings owner: JSON files, existing paths and directories. Host-absolute
 * spellings (P) keep the expectations valid on Windows hosts, where expansion resolves to a drive. */
const P = (value: string) => path.resolve(value);
const HOME = P("/home/u"), CONFIG = P("/home/u/.local/share/Ex/config.json"), SITE = P("/sites/a");
function world({ policy = {}, env = {}, quarantined = true, removable = true, platform = "linux" as NodeJS.Platform | "host", dropbox }: { policy?: Partial<DirectoryUserConfigPolicy>; env?: NodeJS.ProcessEnv; quarantined?: boolean; removable?: boolean; platform?: NodeJS.Platform | "host"; dropbox?: string } = {}) {
  const files = new Map<string, JsonFileRead>(), present = new Set<string>(), dirs = new Set<string>();
  const report = vi.fn(), removeFile = vi.fn(({ filePath }: { filePath: string }) => { files.delete(filePath); });
  const fileAt = (file: string): DurableJsonFile => ({
    read: () => files.get(file) ?? { state: "missing" }, tempPath: () => `${file}.tmp`,
    write: ({ value }) => { files.set(file, { state: "ok", value }); },
    quarantine: () => { if (quarantined) files.delete(file); return quarantined; },
    withLock: ({ critical }) => critical(),
  });
  const config = createDirectoryUserConfig({ homeDir: HOME, defaultFolder: "Product", envName: "P_HOME", policy: { appName: "Ex", rootsEnvName: "P_ROOTS", ...policy },
    fileAt, canonicalPath: ({ path }) => path, exists: (file) => present.has(file) || dirs.has(file), isDirectory: (file) => dirs.has(file), ...(removable ? { removeFile } : {}) },
  { env, cwd: "/cwd", report, ...(platform === "host" ? {} : { platform }), readText: (file) => file === P(`${HOME}/.dropbox/info.json`) ? dropbox : undefined });
  const json = (file: string, value: unknown) => files.set(file, { state: "ok", value });
  return { config, files, present, dirs, report, removeFile, json };
}
const marker = (source: string) => P(`${source}.home2-relocation.json`);

describe("stored settings", () => {
  it("reads past invalid or unreadable settings with a report and never writes", () => {
    for (const bad of [{ state: "ok", value: { sitesHome: 5 } }, { state: "unreadable" }] as JsonFileRead[]) {
      const w = world(); w.files.set(CONFIG, bad);
      expect(w.config.read({}).sitesHome).toBe(P(`${HOME}/Documents/Product`));
      expect(w.report).toHaveBeenCalledWith(expect.stringContaining("User config is unreadable"));
      expect(w.files.get(CONFIG)).toBe(bad);
    }
  });
  it("a locked update quarantines unreadable settings, and refuses to overwrite when quarantine fails", () => {
    const w = world(); w.files.set(CONFIG, { state: "unreadable" });
    expect(w.config.update({ patch: { databases: "appData" } }).databases).toBe("appData");
    expect(w.files.get(CONFIG)).toEqual({ state: "ok", value: { databases: "appData" } });
    const stuck = world({ quarantined: false }); stuck.files.set(CONFIG, { state: "unreadable" });
    expect(() => stuck.config.update({ patch: { databases: "appData" } })).toThrow("Nothing was overwritten");
  });
  it("platform defaults to the host when omitted", () => {
    const w = world({ platform: "host", env: { P_HOME: "/env-home" } });
    expect(w.config.filePath.endsWith("config.json")).toBe(true);
    expect(w.config.read({}).sitesHome).toBe(P("/env-home"));
  });
});

describe("updates", () => {
  it("C59: adding an extra root preserves policy source roots in the effective config", () => {
    const source = P("/repo/sites"), extra = P("/extra"), w = world({ policy: { sourceRoots: [source] } });
    expect(w.config.read({}).siteRoots).toEqual([source]);
    w.config.updateRoots({ add: [extra] });
    expect(w.files.get(CONFIG)).toEqual({ state: "ok", value: { siteRoots: [extra] } });
    expect(w.config.read({}).siteRoots).toEqual([source, extra]);
  });

  it("refuses regular files as folders and settings overridden by the environment", () => {
    const w = world(); w.present.add(P("/file"));
    expect(() => w.config.update({ patch: { sitesHome: "/file" } })).toThrow("Sites folder is not a directory: /file");
    expect(() => w.config.update({ patch: { siteRoots: ["/file"] } })).toThrow("Sites folder is not a directory");
    w.dirs.add(P("/dir"));
    expect(w.config.update({ patch: { sitesHome: "/dir", siteRoots: ["/dir", "/new"] } })).toMatchObject({ sitesHome: P("/dir"), siteRoots: [P("/dir"), P("/new")] });
    expect(() => world({ env: { P_HOME: "/env" } }).config.update({ patch: { sitesHome: "/x" } })).toThrow("P_HOME overrides this setting");
    expect(() => world({ env: { P_ROOTS: "/env" } }).config.update({ patch: { siteRoots: ["/x"] } })).toThrow("P_ROOTS overrides this setting");
    expect(world({ env: { P_HOME: "/env" } }).config.update({ patch: { databases: "inSite" } }).sitesHome).toBe(P("/env"));
  });
  it("removing the final extra root removes the file, or writes {} without a removal port", () => {
    const w = world(); w.json(CONFIG, { siteRoots: ["/x"] });
    w.config.updateRoots({ remove: ["/x"] });
    expect(w.removeFile).toHaveBeenCalledWith({ filePath: CONFIG }); expect(w.files.has(CONFIG)).toBe(false);
    const kept = world({ removable: false }); kept.json(CONFIG, { siteRoots: ["/x"] });
    kept.config.updateRoots({ remove: ["/x"] });
    expect(kept.files.get(CONFIG)).toEqual({ state: "ok", value: {} });
    const plain = world(); plain.config.update({ patch: {} });
    expect(plain.removeFile).not.toHaveBeenCalled(); expect(plain.files.get(CONFIG)).toEqual({ state: "ok", value: {} });
  });
  it("without policy source roots, added roots skip only the home", () => {
    const w = world();
    expect(w.config.updateRoots({ add: ["/x", P(`${HOME}/Documents/Product`)] }).siteRoots).toEqual([P("/x")]);
    expect(w.config.defaultRoots({})).toEqual([]);
  });
});

describe("database placement", () => {
  it("accepts only .db basenames", () => {
    for (const filename of ["x/content.db", "content.sqlite"]) expect(() => world().config.databasePath({ dir: SITE, id: "a", filename })).toThrow(".db basename");
  });
  it("unsafe identities resolve only an existing legacy file without a placement", () => {
    const w = world(); w.present.add(P(`${SITE}/content.db`));
    expect(w.config.databasePath({ dir: SITE, id: "a b", filename: "content.db" })).toBe(P(`${SITE}/content.db`));
    expect(() => w.config.databasePath({ dir: SITE, id: "a b", filename: "content.db", placement: "inSite" })).toThrow("safe, stable site identity");
    expect(() => world().config.databasePath({ dir: SITE, id: "a b", filename: "content.db" })).toThrow("safe, stable site identity");
  });
  it("an explicit placement picks the location without probing", () => {
    const w = world(); w.present.add(P(`${SITE}/content.db`));
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "content.db", placement: "inSite" })).toBe(P(`${SITE}/data.nosync/content.db`));
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "content.db", placement: "appData" })).toBe(P(`${HOME}/.local/share/Ex/databases/a/content.db`));
  });
  it("one existing copy wins; several refuse; none follows content.db, then the preference", () => {
    const appData = P(`${HOME}/.local/share/Ex/databases/a`);
    const w = world(); w.present.add(P(`${appData}/content.db`));
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toBe(P(`${appData}/content.db`));
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "chat.db" })).toBe(P(`${appData}/chat.db`));
    w.present.add(P(`${SITE}/content.db`));
    expect(() => w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toThrow("Multiple copies of content.db");
    expect(world().config.databasePath({ dir: SITE, id: "a", filename: "chat.db" })).toBe(P(`${SITE}/data.nosync/chat.db`));
    const saved = world(); saved.json(CONFIG, { databases: "appData" });
    expect(saved.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toBe(P(`${appData}/content.db`));
  });
  it("interrupted move markers: only valid sibling evidence recovers", () => {
    const source = P(`${SITE}/content.db`), target = P(`${SITE}/data.nosync/content.db`);
    const invalid = [{ state: "unreadable" }, { state: "ok", value: null }, { state: "ok", value: { to: 5 } }, { state: "ok", value: { to: P("/elsewhere.db") } },
      { state: "ok", value: { to: target, backup: 5 } }, { state: "ok", value: { to: target, backup: P("/other/content.db.relocation-x-backup") } },
      { state: "ok", value: { to: target, backup: P(`${SITE}/other.db.relocation-x-backup`) } }, { state: "ok", value: { to: target, backup: P(`${source}.relocation-x-copy`) } }] as JsonFileRead[];
    for (const read of invalid) {
      const w = world(); w.files.set(marker(source), read);
      expect(() => w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toThrow("invalid recovery marker");
    }
    const w = world(); w.json(marker(source), { to: target, backup: P(`${source}.relocation-x-backup`) });
    expect(() => w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toThrow("needs recovery");
    w.present.add(P(`${source}.relocation-x-backup`));
    expect(() => w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toThrow("needs recovery");
    w.present.add(target);
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toBe(target);
    w.present.add(source);
    expect(w.config.databasePath({ dir: SITE, id: "a", filename: "content.db" })).toBe(source);
    expect(w.report).toHaveBeenLastCalledWith(expect.stringContaining(`Recovered interrupted database move using ${source}`));
  });
});

describe("sync defaults and warnings", () => {
  const dropbox = JSON.stringify({ personal: { path: P(`${HOME}/Documents`) } });
  it("a non-iCloud synced home defaults new databases to app-data and warns", () => {
    const w = world({ dropbox });
    expect(w.config.read({}).databases).toBe("appData");
    expect(w.config.syncWarning({})).toEqual({ provider: "Dropbox", message: expect.stringContaining("New databases use OS app-data"), localHome: P(`${HOME}/Product`) });
    w.json(CONFIG, { databases: "inSite" });
    expect(w.config.syncWarning({})?.message).toContain("does not honor data.nosync");
    expect(world().config.syncWarning({})).toBeNull();
  });
  it("an iCloud home keeps in-site databases and raises no warning", () => {
    const w = world({ platform: "darwin", env: { P_HOME: P(`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Product`) } });
    expect(w.config.read({}).databases).toBe("inSite");
    expect(w.config.syncWarning({})).toBeNull();
  });
});

describe("validateDirectoryUserConfig", () => {
  it("accepts only the three public settings with valid shapes", () => {
    for (const value of [null, 5, [], "x"]) expect(() => validateDirectoryUserConfig({ value })).toThrow("must be an object");
    expect(() => validateDirectoryUserConfig({ value: { other: 1 } })).toThrow("Unknown user config setting");
    for (const sitesHome of [5, " "]) expect(() => validateDirectoryUserConfig({ value: { sitesHome } })).toThrow("sitesHome must name a directory");
    for (const siteRoots of ["/x", [" "], [5]]) expect(() => validateDirectoryUserConfig({ value: { siteRoots } })).toThrow("siteRoots must be an array");
    expect(() => validateDirectoryUserConfig({ value: { databases: "cloud" } })).toThrow('databases must be "inSite" or "appData"');
    const value = { sitesHome: "/x", siteRoots: ["/y"], databases: "appData" };
    expect(validateDirectoryUserConfig({ value })).toBe(value);
    expect(validateDirectoryUserConfig({ value: {} })).toEqual({});
  });
});
