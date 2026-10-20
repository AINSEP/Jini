import { describe, expect, it } from "vitest";
import { resolveDirectoryHome } from "../directory-home.js";

const posix = { homeDir: "/users/owner", defaultFolder: "Sites", envName: "SITES_HOME", env: {} };
const win = { homeDir: "C:\\Users\\owner", defaultFolder: "Sites", envName: "SITES_HOME", env: {} };

describe("resolveDirectoryHome precedence", () => {
  it("uses the default folder under the home when neither env nor setting is present", () => {
    expect(resolveDirectoryHome(posix, { platform: "linux" })).toBe("/users/owner/Sites");
  });
  it("resolves a relative setting against the home when no cwd is supplied", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "saved" }, { platform: "linux" })).toBe("/users/owner/saved");
  });
  it("resolves a relative setting against the supplied cwd", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "saved" }, { cwd: "/checkout", platform: "linux" })).toBe("/checkout/saved");
  });
  it("prefers the environment over the setting", () => {
    expect(resolveDirectoryHome({ ...posix, env: { SITES_HOME: "/from-env" }, setting: "/saved" }, { platform: "linux" })).toBe("/from-env");
  });
  it("reads only the named environment variable", () => {
    expect(resolveDirectoryHome({ ...posix, env: { OTHER_HOME: "/other" }, setting: "/saved" }, { platform: "linux" })).toBe("/saved");
  });
  it("normalizes dot segments in an absolute choice", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "/a/./b/../c" }, { platform: "linux" })).toBe("/a/c");
  });
  it("uses the host platform when no platform is supplied", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "/saved" })).toBe(process.platform === "win32" ? "C:\\saved" : "/saved");
  });
});

describe("resolveDirectoryHome refusals", () => {
  it("refuses an empty environment value even when a setting exists", () => {
    expect(() => resolveDirectoryHome({ ...posix, env: { SITES_HOME: "" }, setting: "/saved" }, { platform: "linux" })).toThrow(new Error("SITES_HOME must name a directory"));
  });
  it("refuses a whitespace-only environment value", () => {
    expect(() => resolveDirectoryHome({ ...posix, env: { SITES_HOME: " \t\n" } }, { platform: "linux" })).toThrow(new Error("SITES_HOME must name a directory"));
  });
  it("refuses an empty setting and names the environment variable", () => {
    expect(() => resolveDirectoryHome({ ...posix, setting: "  " }, { platform: "linux" })).toThrow(new Error("SITES_HOME must name a directory"));
  });
});

describe("resolveDirectoryHome tilde expansion", () => {
  it("expands a bare tilde to the supplied home", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "~" }, { cwd: "/checkout", platform: "linux" })).toBe("/users/owner");
  });
  it("expands a tilde-slash prefix under the supplied home, not the cwd", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "~/shared" }, { cwd: "/checkout", platform: "linux" })).toBe("/users/owner/shared");
  });
  it("expands a tilde-backslash prefix on posix too", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "~\\shared" }, { cwd: "/checkout", platform: "linux" })).toBe("/users/owner/shared");
  });
  it("lets a tilde path climb out of the home with dot-dot (no containment by design)", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "~/../elsewhere" }, { platform: "linux" })).toBe("/users/elsewhere");
  });
  it("does not expand a ~user form; it stays relative to the cwd", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "~other/x" }, { cwd: "/checkout", platform: "linux" })).toBe("/checkout/~other/x");
  });
  it("does not expand a tilde that is not the first character", () => {
    expect(resolveDirectoryHome({ ...posix, setting: "a/~/b" }, { cwd: "/checkout", platform: "linux" })).toBe("/checkout/a/~/b");
  });
});

describe("resolveDirectoryHome on win32", () => {
  it("joins the default folder with backslashes", () => {
    expect(resolveDirectoryHome(win, { platform: "win32" })).toBe("C:\\Users\\owner\\Sites");
  });
  it("keeps an absolute drive-letter setting", () => {
    expect(resolveDirectoryHome({ ...win, setting: "D:\\Data\\Sites" }, { platform: "win32" })).toBe("D:\\Data\\Sites");
  });
  it("normalizes forward slashes in a drive-letter setting", () => {
    expect(resolveDirectoryHome({ ...win, setting: "D:/Data/Sites" }, { platform: "win32" })).toBe("D:\\Data\\Sites");
  });
  it("keeps a UNC share path", () => {
    expect(resolveDirectoryHome({ ...win, setting: "\\\\server\\share\\Sites" }, { platform: "win32" })).toBe("\\\\server\\share\\Sites");
  });
  it("resolves a rooted path without a drive onto the cwd drive", () => {
    expect(resolveDirectoryHome({ ...win, setting: "\\Sites" }, { cwd: "E:\\work", platform: "win32" })).toBe("E:\\Sites");
  });
  it("resolves a relative setting against a win32 cwd", () => {
    expect(resolveDirectoryHome({ ...win, setting: "sites\\dev" }, { cwd: "E:\\work", platform: "win32" })).toBe("E:\\work\\sites\\dev");
  });
  it("expands a tilde-backslash prefix under the home", () => {
    expect(resolveDirectoryHome({ ...win, setting: "~\\shared" }, { cwd: "E:\\work", platform: "win32" })).toBe("C:\\Users\\owner\\shared");
  });
  it("expands a tilde-slash prefix under the home", () => {
    expect(resolveDirectoryHome({ ...win, setting: "~/shared" }, { cwd: "E:\\work", platform: "win32" })).toBe("C:\\Users\\owner\\shared");
  });
  it("expands a bare tilde to the home", () => {
    expect(resolveDirectoryHome({ ...win, setting: "~" }, { cwd: "E:\\work", platform: "win32" })).toBe("C:\\Users\\owner");
  });
});
