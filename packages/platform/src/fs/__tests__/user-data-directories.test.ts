import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({ execFileSync: vi.fn<(file: string, args: string[], options: object) => string>() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: native.execFileSync }));
import { readOptionalText, readWindowsOneDriveRoots, resolveUserDataDirectories } from "../user-data-directories.js";

// reg.exe is run by absolute path under System32, not through the cwd-first command search.
const SYSTEM32_REG = /^[A-Za-z]:\\.*\\System32\\reg\.exe$/i;

const roots: string[] = [];
beforeEach(() => { native.execFileSync.mockReset(); });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const SHELL_FOLDERS = ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"];
const REG_OPTIONS = { encoding: "utf8", timeout: 3000, windowsHide: true };

// --- appDataDir validation -------------------------------------------------
for (const [platform, appDataDir] of [["linux", ""], ["linux", "   "], ["linux", "relative/profile"], ["win32", "C:relative"], ["win32", "profile"]] as const) {
  test(`${platform} refuses appDataDir ${JSON.stringify(appDataDir)}`, () => {
    expect(() => resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform, appDataDir, readText: () => undefined, windowsDocuments: () => undefined }))
      .toThrow("appDataDir must be an absolute profile directory.");
  });
}
test("win32 accepts a drive-absolute and a UNC appDataDir", () => {
  for (const appDataDir of ["D:\\Profiles\\App", "\\\\server\\share\\App"]) {
    expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {}, appDataDir, windowsDocuments: () => undefined }).appData).toBe(appDataDir);
  }
});

// --- Windows -----------------------------------------------------------------
test("win32 uses roaming APPDATA and expands %VARS% in the redirected Personal folder", () => {
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, {
    platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming", USERPROFILE: "C:\\Users\\u" }, windowsDocuments: () => "%USERPROFILE%\\OneDrive\\Documents",
  })).toEqual({ appData: "C:\\Users\\u\\AppData\\Roaming\\App", documents: "C:\\Users\\u\\OneDrive\\Documents" });
});
test("win32 keeps an unknown %VAR% literally rather than dropping it", () => {
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {}, windowsDocuments: () => "%MISSING%\\Docs" }).documents).toBe("%MISSING%\\Docs");
});
test("win32 falls back to <home>\\AppData\\Roaming and <home>\\Documents", () => {
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {}, windowsDocuments: () => undefined }))
    .toEqual({ appData: "C:\\Users\\u\\AppData\\Roaming\\App", documents: "C:\\Users\\u\\Documents" });
});
test("win32 reads the Personal known folder from the registry by default", () => {
  native.execFileSync.mockReturnValue("\r\nHKEY_CURRENT_USER\\...\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents  \r\n");
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: { USERPROFILE: "D:\\u" } }).documents).toBe("D:\\u\\Documents");
  expect(native.execFileSync).toHaveBeenCalledWith(expect.stringMatching(SYSTEM32_REG), SHELL_FOLDERS, REG_OPTIONS);
});
test("win32 registry output without a Personal value falls back to <home>\\Documents", () => {
  native.execFileSync.mockReturnValue("ERROR-free but empty\r\n");
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {} }).documents).toBe("C:\\Users\\u\\Documents");
});
test("win32 accepts a plain REG_SZ Personal value", () => {
  native.execFileSync.mockReturnValue("    Personal    REG_SZ    E:\\Docs\r\n");
  expect(resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {} }).documents).toBe("E:\\Docs");
});
test("win32 registry failure propagates from the resolver", () => {
  const error = Object.assign(new Error("spawnSync reg.exe ETIMEDOUT"), { code: "ETIMEDOUT" });
  native.execFileSync.mockImplementation(() => { throw error; });
  expect(() => resolveUserDataDirectories({ homeDir: "C:\\Users\\u", appName: "App" }, { platform: "win32", env: {} })).toThrow(error);
});

// --- macOS / Linux ---------------------------------------------------------
test("darwin uses Application Support and ~/Documents", () => {
  expect(resolveUserDataDirectories({ homeDir: "/Users/u", appName: "App" }, { platform: "darwin", env: {} }))
    .toEqual({ appData: "/Users/u/Library/Application Support/App", documents: "/Users/u/Documents" });
});
test("linux honours XDG_DATA_HOME, XDG_CONFIG_HOME and an XDG_DOCUMENTS_DIR using $HOME", () => {
  const readText = vi.fn(() => '# comment\nXDG_DESKTOP_DIR="$HOME/Desktop"\nXDG_DOCUMENTS_DIR="$HOME/Papers"\n');
  expect(resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform: "linux", env: { XDG_DATA_HOME: "/data", XDG_CONFIG_HOME: "/cfg" }, readText }))
    .toEqual({ appData: "/data/App", documents: "/home/u/Papers" });
  expect(readText).toHaveBeenCalledWith("/cfg/user-dirs.dirs");
});
test("linux defaults to ~/.local/share and ~/.config/user-dirs.dirs", () => {
  const readText = vi.fn(() => undefined);
  expect(resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform: "linux", env: {}, readText }))
    .toEqual({ appData: "/home/u/.local/share/App", documents: "/home/u/Documents" });
  expect(readText).toHaveBeenCalledWith("/home/u/.config/user-dirs.dirs");
});
for (const [label, text] of [["a relative XDG_DOCUMENTS_DIR", 'XDG_DOCUMENTS_DIR="Papers"\n'], ["an empty XDG_DOCUMENTS_DIR", 'XDG_DOCUMENTS_DIR=""\n'], ["no XDG_DOCUMENTS_DIR", 'XDG_MUSIC_DIR="$HOME/Music"\n']] as const) {
  test(`linux falls back to ~/Documents for ${label}`, () => {
    expect(resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform: "linux", env: {}, readText: () => text }).documents).toBe("/home/u/Documents");
  });
}
test("an explicit appDataDir wins on every platform", () => {
  expect(resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform: "linux", env: {}, appDataDir: "/profile", readText: () => undefined }).appData).toBe("/profile");
  expect(resolveUserDataDirectories({ homeDir: "/Users/u", appName: "App" }, { platform: "darwin", env: {}, appDataDir: "/profile" }).appData).toBe("/profile");
});

// --- native readers --------------------------------------------------------
test("readOptionalText returns file text and undefined for a missing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-dirs-")); roots.push(dir);
  fs.writeFileSync(path.join(dir, "f"), "text");
  expect(readOptionalText({ file: path.join(dir, "f") })).toBe("text");
  expect(readOptionalText({ file: path.join(dir, "missing") })).toBeUndefined();
});
test("readOptionalText propagates a non-ENOENT failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-dirs-")); roots.push(dir);
  expect(() => readOptionalText({ file: dir })).toThrow(expect.objectContaining({ code: "EISDIR" }));
});
test("readWindowsOneDriveRoots lists every account UserFolder, trimmed", () => {
  native.execFileSync.mockReturnValue("HKEY\\Personal\r\n    UserFolder    REG_SZ    C:\\Users\\u\\OneDrive  \r\nHKEY\\Business1\r\n    UserFolder    REG_EXPAND_SZ    C:\\Users\\u\\OneDrive - Corp\r\n");
  expect(readWindowsOneDriveRoots({})).toEqual(["C:\\Users\\u\\OneDrive", "C:\\Users\\u\\OneDrive - Corp"]);
  expect(native.execFileSync).toHaveBeenCalledWith(expect.stringMatching(SYSTEM32_REG), ["query", "HKCU\\Software\\Microsoft\\OneDrive\\Accounts", "/s", "/v", "UserFolder"], REG_OPTIONS);
});
test("readWindowsOneDriveRoots treats reg.exe exit status 1 (key absent) as no accounts", () => {
  native.execFileSync.mockImplementation(() => { throw Object.assign(new Error("Command failed: reg.exe"), { status: 1 }); });
  expect(readWindowsOneDriveRoots({})).toEqual([]);
});
test("readWindowsOneDriveRoots propagates any other reg.exe failure", () => {
  const error = Object.assign(new Error("Command failed: reg.exe"), { status: 5 });
  native.execFileSync.mockImplementation(() => { throw error; });
  expect(() => readWindowsOneDriveRoots({})).toThrow(error);
});
test("linux reads user-dirs.dirs from disk by default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-dirs-")); roots.push(dir);
  fs.writeFileSync(path.join(dir, "user-dirs.dirs"), 'XDG_DOCUMENTS_DIR="/srv/docs"\n');
  expect(resolveUserDataDirectories({ homeDir: "/home/u", appName: "App" }, { platform: "linux", env: { XDG_CONFIG_HOME: dir } }).documents).toBe("/srv/docs");
});
