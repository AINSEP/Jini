import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { afterEach, test, vi } from "vitest";

import { isSeaRuntime, seaApi, type SeaApi } from "../sea-runtime.js";

const sea = createRequire(import.meta.url)("node:sea") as SeaApi;

// F7.2/F7.6: control the runtime boundary rather than rely on the current Node binary;
// the spies are restored after each test. The subject's require/detection remains real.
afterEach(() => {
  vi.restoreAllMocks();
});

test("plain Node exposes no embedded asset API", () => {
  vi.spyOn(sea, "isSea").mockImplementation(() => false);
  assert.equal(seaApi({ orFallbackSync }), null);
  assert.equal(isSeaRuntime({ orFallbackSync }), false);
});

test("the probe failure is routed through the host-injected fallback callable", () => {
  const probeError = new Error("SEA API unavailable");
  vi.spyOn(sea, "isSea").mockImplementation(() => { throw probeError; });
  const steps: string[] = [];
  const hostFallback = vi.fn(({ work, fallback, step }: { work: () => SeaApi | null; fallback: null; step: string }) => {
    steps.push(step);
    try { return work(); } catch (error) { assert.equal(error, probeError); return fallback; }
  });
  assert.equal(seaApi({ orFallbackSync: hostFallback }), null);
  assert.equal(isSeaRuntime({ orFallbackSync: hostFallback }), false);
  assert.deepEqual(steps, ["Probe bundled runtime", "Probe bundled runtime"]);
});

test("a SEA process exposes the native asset API and reports SEA runtime", () => {
  vi.spyOn(sea, "isSea").mockImplementation(() => true);
  const assets = vi.spyOn(sea, "getAsset").mockImplementation((key: string) => {
    assert.equal(key, "admin/index.html");
    return Uint8Array.from([60, 104, 49, 62]).buffer;
  });
  assert.equal(seaApi({ orFallbackSync }), sea);
  assert.equal(isSeaRuntime({ orFallbackSync }), true);
  assert.deepEqual(new Uint8Array(seaApi({ orFallbackSync })!.getAsset("admin/index.html")), Uint8Array.from([60, 104, 49, 62]));
  assert.equal(assets.mock.calls.length, 1);
});

test("a failed native SEA probe safely falls back to a non-SEA runtime", () => {
  vi.spyOn(sea, "isSea").mockImplementation(() => { throw new Error("SEA API unavailable"); });
  assert.equal(seaApi({ orFallbackSync }), null);
  assert.equal(isSeaRuntime({ orFallbackSync }), false);
});
