import { describe, expect, it } from "vitest";

import { chartProviderAsset, chartProviderMetadata, type ChartProviderEntry } from "../chart-providers.js";

/** @file Framework-neutral chart-provider replies: metadata fallback and Cache-Control, exact asset matching and headers. */

const BYTES = new TextEncoder().encode("export const chart = 1;\n");
const PROVIDERS: readonly ChartProviderEntry[] = [
  { pluginId: "acme/charts", version: "1.0.0", assets: [{ digest: "sha256-d1", path: "dist/index.js", contentType: "text/javascript", readBytes: () => BYTES }] },
  { pluginId: "acme/charts", version: "2.0.0", assets: [{ digest: "sha256-d2", path: "dist/index.js", contentType: "text/javascript", readBytes: () => new Uint8Array() }] },
];
const CORE = { generation: "core", siteProvider: "core.table", providers: [] as string[] };
const deps = { browserProviders: () => ({ providers: PROVIDERS }) };
const params = { pluginId: "acme/charts", version: "1.0.0", digest: "sha256-d1", filename: "index.js" };

describe("chartProviderMetadata", () => {
  it("answers the snapshot as { data } with Cache-Control no-store", async () => {
    const snapshot = { generation: "g7", siteProvider: "plugin.recharts", providers: ["plugin.recharts"] };
    const reply = await chartProviderMetadata({ deps: { chartProviderSnapshot: async () => snapshot, coreSnapshot: CORE } });
    expect(reply).toEqual({ status: 200, headers: { "Cache-Control": "no-store" }, body: { data: snapshot } });
  });

  it("falls back to the injected core snapshot when no snapshot port is composed", async () => {
    const reply = await chartProviderMetadata({ deps: { coreSnapshot: CORE } });
    expect(reply.body).toEqual({ data: CORE });
    expect(reply.headers["Cache-Control"]).toBe("no-store");
  });

  it("lets a failing snapshot port propagate for the host's failure envelope", async () => {
    await expect(chartProviderMetadata({ deps: { chartProviderSnapshot: async () => { throw new Error("ledger"); }, coreSnapshot: CORE } })).rejects.toThrow("ledger");
  });
});

describe("chartProviderAsset", () => {
  it("answers the retained bytes with content type, nosniff and the immutable private cache header", () => {
    const reply = chartProviderAsset({ deps, params });
    expect(reply.status).toBe(200);
    expect(reply.headers).toEqual({ "Content-Type": "text/javascript", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" });
    expect(reply.body).toBe(BYTES);
  });

  it.each([
    ["digest", { ...params, digest: "sha256-bad" }],
    ["file name", { ...params, filename: "other.js" }],
    ["version", { ...params, version: "9.9.9" }],
    ["plugin", { ...params, pluginId: "other" }],
    ["version's digest under another version", { ...params, digest: "sha256-d2" }],
  ])("is a 404 with no asset headers for a wrong %s", (_name, wrong) => {
    expect(chartProviderAsset({ deps, params: wrong })).toEqual({ status: 404, headers: {}, body: { error: "chart asset was not found" } });
  });

  it("is a 404 for every URL when no browser-provider port is composed", () => {
    expect(chartProviderAsset({ deps: {}, params }).status).toBe(404);
  });
});
