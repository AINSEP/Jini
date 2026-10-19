import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detectDirectorySync } from "../directory-sync.js";
// The default account-root port shells out to reg.exe; replace only that export so the default wiring is observable on every OS.
vi.mock("../user-data-directories.js", async (original) => ({ ...await original<typeof import("../user-data-directories.js")>(), readWindowsOneDriveRoots: () => ["W:\\Account"] }));
const input = { dir: "/user/Documents/Project", homeDir: "/user", documents: "/user/Documents" };
const ports = { platform: "darwin" as const, env: {}, canonicalPath: ({ path: value }: { path: string }) => value, readText: () => undefined, listDirectories: () => [], exists: () => false };
describe("sync detection uses containment and provider evidence", () => {
  it("detects iCloud Documents only when cloud Documents exists, not mere iCloud installation", () => {
    expect(detectDirectorySync(input, ports)).toBeNull();
    expect(detectDirectorySync(input, { ...ports, exists: (file) => file === "/user/Library/Mobile Documents/com~apple~CloudDocs/Documents" })).toBe("iCloud");
  });
  it("follows canonical Documents redirection into OneDrive and ignores unrelated local folders", () => {
    const canonicalPath = ({ path: value }: { path: string }) => value.replace("/user/Documents", "/cloud/Documents");
    expect(detectDirectorySync(input, { ...ports, env: { OneDriveCommercial: "/cloud" }, canonicalPath })).toBe("OneDrive");
    expect(detectDirectorySync({ ...input, dir: "/local/Project" }, { ...ports, env: { OneDrive: "/cloud" }, canonicalPath })).toBeNull();
    expect(detectDirectorySync({ ...input, dir: "/cloud-other/Project" }, { ...ports, env: { OneDrive: "/cloud" } })).toBeNull();
  });
  it("uses Dropbox account info and Google Drive File Provider mounts", () => {
    expect(detectDirectorySync({ ...input, dir: "/custom/Dropbox/Documents/Project" }, { ...ports, readText: (file) => file === "/user/.dropbox/info.json" ? JSON.stringify({ personal: { path: "/custom/Dropbox" } }) : undefined })).toBe("Dropbox");
    expect(detectDirectorySync({ ...input, dir: "/user/Library/CloudStorage/GoogleDrive-a/Documents/Project" }, { ...ports, listDirectories: () => ["GoogleDrive-a"] })).toBe("Google Drive");
  });
  it("ignores corrupt Dropbox metadata without masking other provider evidence", () => {
    for (const text of ["{broken", "null", "42"]) {
      const readText = (file: string) => file.endsWith("info.json") ? text : undefined;
      expect(detectDirectorySync(input, { ...ports, readText })).toBeNull();
      expect(detectDirectorySync(input, { ...ports, readText, env: { OneDrive: "/user/Documents" } })).toBe("OneDrive");
    }
  });
  it("uses ancestor marker files rather than the site's folder name", () => {
    expect(detectDirectorySync(input, { ...ports, exists: (file) => file === path.join("/user/Documents", ".tmp.drivedownload") })).toBe("Google Drive");
    expect(detectDirectorySync(input, { ...ports, exists: (file) => file === path.join("/user", ".dropbox.cache") })).toBe("Dropbox");
    expect(detectDirectorySync({ ...input, dir: "/user/Dropbox" }, ports)).toBeNull();
  });
  it("compares Windows provider paths case-insensitively", () => {
    expect(detectDirectorySync({ homeDir: "C:\\Users\\a", documents: "D:\\Cloud\\Documents", dir: "d:\\cloud\\Documents\\Project" }, {
      ...ports, platform: "win32", env: { OneDrive: "D:\\Cloud" },
    })).toBe("OneDrive");
  });
});
it('uses injected Windows account roots when OneDrive env vars are absent', () => {
  expect(detectDirectorySync({ homeDir: 'C:\\Users\\a', documents: 'E:\\Account\\Documents', dir: 'E:\\Account\\Documents\\Project' }, {
    ...ports, platform: 'win32', env: {}, windowsOneDriveRoots: () => ['E:\\Account'],
  })).toBe('OneDrive');
});
describe("provider root boundaries", () => {
  it("maps each File Provider mount prefix and ignores unknown mounts", () => {
    const at = (name: string) => detectDirectorySync({ ...input, dir: `/user/Library/CloudStorage/${name}/Project` }, { ...ports, listDirectories: () => ["Box-a", name] });
    expect(at("OneDrive-Personal")).toBe("OneDrive");
    expect(at("GoogleDrive-a")).toBe("Google Drive");
    expect(at("Dropbox-Team")).toBe("Dropbox");
    expect(at("Box-a")).toBeNull();
    expect(detectDirectorySync({ ...input, dir: "/user/Library/CloudStorage/OneDrive-a/Project" }, { ...ports, platform: "linux", listDirectories: () => ["OneDrive-a"] })).toBeNull();
  });
  it("default ports: a missing CloudStorage lists nothing, other listing failures surface, unresolvable paths resolve lexically", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dir-sync-"));
    try {
      const real = { dir: path.join(home, "missing", "Project"), homeDir: home, documents: path.join(home, "Documents") };
      expect(detectDirectorySync(real, { platform: "darwin", env: {}, readText: () => undefined, exists: () => false })).toBeNull();
      expect(detectDirectorySync(real, { platform: "darwin", env: { OneDrive: path.join(home, "missing") }, readText: () => undefined, exists: () => false })).toBe("OneDrive");
      fs.mkdirSync(path.join(home, "Library")); fs.writeFileSync(path.join(home, "Library", "CloudStorage"), "");
      expect(() => detectDirectorySync(real, { platform: "darwin", env: {}, readText: () => undefined, exists: () => false })).toThrow(expect.objectContaining({ code: "ENOTDIR" }));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  it("Windows reads Dropbox info from APPDATA and LOCALAPPDATA and skips account roots when OneDrive env is set", () => {
    const win = { homeDir: "C:\\Users\\a", documents: "C:\\Users\\a\\Documents", dir: "F:\\Box\\Project" };
    const seen: string[] = [];
    const readText = (file: string) => { seen.push(file); return file === "L:\\Local\\Dropbox\\info.json" ? JSON.stringify({ a: null, b: { path: 7 }, c: { path: "F:\\Box" } }) : undefined; };
    expect(detectDirectorySync(win, { ...ports, platform: "win32", env: { APPDATA: "R:\\Roaming", LOCALAPPDATA: "L:\\Local" }, readText, windowsOneDriveRoots: () => [] })).toBe("Dropbox");
    expect(seen).toEqual(["R:\\Roaming\\Dropbox\\info.json", "L:\\Local\\Dropbox\\info.json"]);
    expect(detectDirectorySync(win, { ...ports, platform: "win32", env: {}, windowsOneDriveRoots: () => ["F:\\Box"] })).toBe("OneDrive");
    for (const env of [{ OneDrive: "Z:\\x" }, { OneDriveConsumer: "Z:\\x" }, { OneDriveCommercial: "Z:\\x" }]) {
      expect(detectDirectorySync(win, { ...ports, platform: "win32", env, windowsOneDriveRoots: () => { throw new Error("must not read account roots"); } })).toBeNull();
    }
    expect(detectDirectorySync(win, { ...ports, platform: "win32", env: {}, oneDriveRoots: ["F:\\Box"], windowsOneDriveRoots: () => [] })).toBe("OneDrive");
  });
  it("a provider root contains only itself and its descendants, not same-prefix siblings", () => {
    const options = { ...ports, env: { OneDrive: "/cloud" } };
    expect(detectDirectorySync({ ...input, dir: "/cloud" }, options)).toBe("OneDrive");
    expect(detectDirectorySync({ ...input, dir: "/cloudy/Project" }, options)).toBeNull();
    expect(detectDirectorySync({ ...input, dir: "/x/.tmp.driveupload" }, { ...ports, exists: (file) => file === "/x/.tmp.driveupload" })).toBe("Google Drive");
  });
  it("Windows without OneDrive env reads account roots through the default registry port", () => {
    expect(detectDirectorySync({ homeDir: "C:\\Users\\a", documents: "C:\\Users\\a\\Documents", dir: "W:\\Account\\Project" }, { ...ports, platform: "win32", env: {} })).toBe("OneDrive");
  });
});
