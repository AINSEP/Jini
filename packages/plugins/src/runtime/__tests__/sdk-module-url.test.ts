import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { sdkModuleUrl } from "../sdk-resolver.js";

test("a filesystem path becomes a file URL", () => {
  expect(sdkModuleUrl({ sdkModulePath: "/opt/sdk build/index.js" })).toBe(pathToFileURL("/opt/sdk build/index.js").href);
});

test("a valid file URL is normalized as a URL, not re-encoded as a path", () => {
  const url = "file:///opt/sdk%20build/index.js";
  expect(sdkModuleUrl({ sdkModulePath: url })).toBe(url);
  // Mutation pinned: routing a URL string through pathToFileURL would yield "file:///<cwd>/file:/..." or double-encode "%20".
  expect(sdkModuleUrl({ sdkModulePath: url })).not.toBe(pathToFileURL(url).href);
});

test("a malformed file URL fails loudly instead of becoming a path", () => {
  expect(() => sdkModuleUrl({ sdkModulePath: "file://[bad" })).toThrow(TypeError);
});
