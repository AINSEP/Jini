import { describe, expect, it, vi } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { recoveryDisclosureRoute, type RecoveryDisclosureRouteDeps } from "../disclosure.js";

const disclosure = { partial: true, watermarkBaselineAvailable: false, counts: { posts_pages: "unknown", plugin_table: "unknown" } };

/** A typed fake on the same seam production injects: the host binds `computeDisclosure` to the
 *  database package's computation; this spec forwards the id plus its covered-category list and
 *  answers the result as-is. */
function harness() {
  const computeDisclosure = vi.fn<RecoveryDisclosureRouteDeps["computeDisclosure"]>(async () => disclosure);
  const deps: RecoveryDisclosureRouteDeps = { computeDisclosure };
  return { deps, computeDisclosure, authorize: vi.fn(async () => undefined) };
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

  it("forwards the restore point and covered categories after authorizing backup.read, answering the computation as-is", async () => {
    const { deps, computeDisclosure, authorize } = harness();
    const parsed = recoveryDisclosureRoute.parse({ body: { restorePointId: "rp-1" }, query: {}, params: {} });
    if (!parsed.ok) throw new Error("parse must be total");
    const result = await recoveryDisclosureRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {});
    expect(result).toEqual({ ok: true, value: disclosure });
    expect(authorize).toHaveBeenCalledWith({ permission: "backup.read", entityType: "restore-point" });
    // The versioned covered list lives in this spec: only write paths confirmed watermark-stamped.
    expect(computeDisclosure.mock.calls).toEqual([[{ restorePointId: "rp-1", coveredCategories: ["posts_pages", "plugin_table"] }]]);
  });

  it("refuses a missing, non-string or absent-body restorePointId with 400 VALIDATION_ERROR, after authorizing", async () => {
    for (const body of [{}, undefined, { restorePointId: 42 }]) {
      const { deps, computeDisclosure, authorize } = harness();
      const parsed = recoveryDisclosureRoute.parse({ body, query: {}, params: {} });
      if (!parsed.ok) throw new Error("parse must be total");
      const response = await refusal(Promise.resolve(recoveryDisclosureRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {})));
      expect(response).toEqual({ status: 400, body: { error: "'restorePointId' (string) is required", code: "VALIDATION_ERROR" } });
      expect(authorize).toHaveBeenCalledOnce();
      expect(computeDisclosure).not.toHaveBeenCalled();
    }
  });

  it("throws when mounted without a principal or an authorizer", async () => {
    const { deps, authorize } = harness();
    await expect(Promise.resolve(recoveryDisclosureRoute.handle({ input: { restorePointId: "rp-1" }, deps, authorize }, {}))).rejects.toThrow(/principal/);
    await expect(Promise.resolve(recoveryDisclosureRoute.handle({ input: { restorePointId: "rp-1" }, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
  });
});
