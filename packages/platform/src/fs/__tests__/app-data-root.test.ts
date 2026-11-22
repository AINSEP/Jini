import { describe, expect, it } from "vitest";
import { resolveElectronAppDataRoot, resolveElectronUserDataDir } from "../app-data-root.js";

const cases: {
  name: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  root: string | undefined;
  userData: string | undefined;
}[] = [
  { name: "darwin", platform: "darwin", env: {}, homeDir: "/Users/o",
    root: "/Users/o/Library/Application Support", userData: "/Users/o/Library/Application Support/example-desktop" },
  { name: "linux with XDG_CONFIG_HOME", platform: "linux", env: { XDG_CONFIG_HOME: "/x/cfg" }, homeDir: "/home/o",
    root: "/x/cfg", userData: "/x/cfg/example-desktop" },
  { name: "linux without XDG_CONFIG_HOME", platform: "linux", env: {}, homeDir: "/home/o",
    root: "/home/o/.config", userData: "/home/o/.config/example-desktop" },
  { name: "linux with blank XDG_CONFIG_HOME", platform: "linux", env: { XDG_CONFIG_HOME: "  " }, homeDir: "/home/o",
    root: "/home/o/.config", userData: "/home/o/.config/example-desktop" },
  { name: "win32 with APPDATA", platform: "win32", env: { APPDATA: "C:\\A" }, homeDir: "C:\\Users\\o",
    root: "C:\\A", userData: "C:\\A\\example-desktop" },
  { name: "win32 without APPDATA", platform: "win32", env: {}, homeDir: "C:\\Users\\o",
    root: "C:\\Users\\o\\AppData\\Roaming", userData: "C:\\Users\\o\\AppData\\Roaming\\example-desktop" },
  { name: "unknown platform", platform: "aix", env: {}, homeDir: "/home/o",
    root: undefined, userData: undefined },
];

describe("Electron application-data conventions", () => {
  it.each(cases)("resolves userData for $name", ({ platform, env, homeDir, userData }) => {
    expect(resolveElectronUserDataDir({ platform, env, homeDir, appName: "example-desktop" })).toBe(userData);
  });

  it.each(cases)("resolves the root without an app name for $name", ({ platform, env, homeDir, root }) => {
    expect(resolveElectronAppDataRoot({ platform, env, homeDir })).toBe(root);
  });

  it("rejects an empty app name", () => {
    expect(() => resolveElectronUserDataDir({ platform: "darwin", env: {}, homeDir: "/Users/o", appName: "" }))
      .toThrow("appName must be a non-empty string.");
  });
});
