import { expect, test, vi } from "vitest";

// A browser has no Node crypto implementation. Fail at module evaluation if the universal
// product entry ever follows the visitor-ingest hashing/salt imports again (obs2 #4).
vi.mock("node:crypto", () => { throw new Error("Node crypto reached the universal product entry"); });

test("the product entry imports and validates events without Node crypto shims", async () => {
  const { withProductAnalyticsGuards } = await import("../product/index.js");
  const events: unknown[] = [];
  const port = withProductAnalyticsGuards({
    inner: { capture: (event) => { events.push(event); }, identify: () => {} },
    consent: () => true,
  });
  port.capture({ name: "assistant_tool_call", userId: "u1", properties: { ok: true } });
  port.capture({ name: "assistant_tool_call", userId: "u1", properties: { email: "private" } });
  expect(events).toEqual([{ name: "assistant_tool_call", userId: "u1", properties: { ok: true } }]);
});

test("obs #4: the product entry bundles for a browser target with no Node builtin or shim", async () => {
  const { build } = await import("esbuild");
  const { fileURLToPath } = await import("node:url");
  // esbuild's browser platform cannot resolve `node:*` imports, so any Node dependency fails the build.
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../product/index.ts", import.meta.url))],
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs.some((input) => input.includes("privacy"))).toBe(true);
  expect(inputs.filter((input) => /ingest|salt|posthog/.test(input))).toEqual([]);
});
