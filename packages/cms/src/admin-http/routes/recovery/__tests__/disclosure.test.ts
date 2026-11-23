import { describe, expect, it, vi } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { recoveryDisclosureRoute, type RecoveryDisclosureRouteDeps } from "../disclosure.js";

function harness(baseline: { available: boolean; watermarkAtCapture?: number | null } = { available: false }) {
  const deps: RecoveryDisclosureRouteDeps = {
    disclosureWatermarkSource: { getBaseline: vi.fn(async () => baseline), getCategoryCounts: vi.fn(async () => ({ posts_pages: 2, plugin_table: 0, entries: 9 })) },
  };
  return { deps, authorize: vi.fn(async () => undefined) };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return (error as RouteRefusalError).response;
}

describe("recoveryDisclosureRoute", () => {
  it("keeps the method and path byte-identical", () => {
    expect(recoveryDisclosureRoute.method).toBe("post");
    expect(recoveryDisclosureRoute.path).toBe("/api/admin/v1/recovery/disclosure");
  });

  it("renders 'unknown' for every covered category while no baseline exists, after authorizing backup.read", async () => {
    const { deps, authorize } = harness();
    const parsed = recoveryDisclosureRoute.parse({ body: { restorePointId: "rp-1" }, query: {}, params: {} });
    if (!parsed.ok) throw new Error("parse must be total");
    const result = await recoveryDisclosureRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {});
    expect(result).toEqual({ ok: true, value: { partial: true, watermarkBaselineAvailable: false, counts: { posts_pages: "unknown", plugin_table: "unknown" } } });
    expect(authorize).toHaveBeenCalledWith({ permission: "backup.read", entityType: "restore-point" });
  });

  it("limits real counts to the covered categories", async () => {
    const { deps, authorize } = harness({ available: true, watermarkAtCapture: 1 });
    const result = await recoveryDisclosureRoute.handle({ input: { restorePointId: "rp-1" }, deps, context: { id: "p-1" }, authorize }, {});
    expect(result.ok && Object.keys(result.value.counts).sort()).toEqual(["plugin_table", "posts_pages"]);
  });

  it("refuses a missing, non-string or absent-body restorePointId with 400 VALIDATION_ERROR, after authorizing", async () => {
    for (const body of [{}, undefined, { restorePointId: 42 }]) {
      const { deps, authorize } = harness();
      const parsed = recoveryDisclosureRoute.parse({ body, query: {}, params: {} });
      if (!parsed.ok) throw new Error("parse must be total");
      const response = await refusal(Promise.resolve(recoveryDisclosureRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {})));
      expect(response).toEqual({ status: 400, body: { error: "'restorePointId' (string) is required", code: "VALIDATION_ERROR" } });
      expect(authorize).toHaveBeenCalledOnce();
    }
  });

  it("throws when mounted without a principal or an authorizer", async () => {
    const { deps, authorize } = harness();
    await expect(Promise.resolve(recoveryDisclosureRoute.handle({ input: { restorePointId: "rp-1" }, deps, authorize }, {}))).rejects.toThrow(/principal/);
    await expect(Promise.resolve(recoveryDisclosureRoute.handle({ input: { restorePointId: "rp-1" }, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
  });
});
