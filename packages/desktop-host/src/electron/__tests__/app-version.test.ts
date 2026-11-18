/** App-version bridge contract with a second-host tag convention (`acme-v*`, `-beta` suffix). */
import { describe, expect, test, vi } from "vitest";
import { registerAppVersionBridge, resolveDevAppVersion } from "../app-version.js";

const versionFromTag = (tag: string) => (tag.startsWith("acme-v") && tag.length > 6 ? tag.slice(6) : null);
const base = { repoRoot: "/repo", versionFromTag, devSuffix: "-beta" };

describe("resolveDevAppVersion", () => {
  test("uses the nearest release tag, trimmed, with the host suffix", async () => {
    expect(await resolveDevAppVersion({ ...base, packageVersion: "1.0.0", describeTag: async ({ cwd }) => { expect(cwd).toBe("/repo"); return "acme-v2.4.1\n"; } })).toBe("2.4.1-beta");
  });
  test("falls back to the package version for a non-release tag, a bare prefix, an empty tag or a failing port", async () => {
    for (const describeTag of [async () => "other-v9", async () => "acme-v", async () => "", async () => { throw new Error("no git"); }]) {
      expect(await resolveDevAppVersion({ ...base, packageVersion: "1.0.0", describeTag })).toBe("1.0.0-beta");
    }
  });
});

describe("registerAppVersionBridge", () => {
  const fixture = (isPackaged: boolean, describeTag = vi.fn(async () => "acme-v3.0.0")) => {
    const handlers = new Map<string, () => string | Promise<string>>();
    let reads = 0;
    registerAppVersionBridge({ ...base, channel: "acme:version", describeTag,
      ipcMain: { handle: (channel, listener) => { handlers.set(channel, listener); } },
      app: { getVersion: () => `pkg-${++reads}`, isPackaged } });
    return { handlers, describeTag, reads: () => reads };
  };
  test("packaged builds read the app version per request and never ask for a tag", async () => {
    const { handlers, describeTag, reads } = fixture(true);
    const handler = handlers.get("acme:version")!;
    expect([await handler(), await handler()]).toEqual(["pkg-1", "pkg-2"]);
    expect(reads()).toBe(2);
    expect(describeTag).not.toHaveBeenCalled();
  });
  test("a dev launch resolves the version once at registration", async () => {
    const { handlers, describeTag } = fixture(false);
    const handler = handlers.get("acme:version")!;
    expect([await handler(), await handler()]).toEqual(["3.0.0-beta", "3.0.0-beta"]);
    expect(describeTag).toHaveBeenCalledOnce();
  });
});
