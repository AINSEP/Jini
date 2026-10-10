import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDirectorySync } from "../directory-sync.js";
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
