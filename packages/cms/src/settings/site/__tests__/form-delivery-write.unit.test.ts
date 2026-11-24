import assert from "node:assert/strict";
import { test, vi } from "vitest";

import type { SetValueRequired } from "@jini-ai/core/settings";

import type { SiteSettingsWritePolicies } from "../site-title-write.js";

/**
 * @file The typed bindings write goes through the host settings chokepoint (`site-title-write.ts`'s
 * `set`), not the package's `set`, so every host write rule applies to it as to the settings route.
 * The host's `writePolicies` reach that chokepoint unchanged (the same object the caller passed).
 */

const seen: Array<SetValueRequired & { writePolicies: SiteSettingsWritePolicies }> = [];
vi.mock("../site-title-write.js", () => ({
  set: async (required: SetValueRequired & { writePolicies: SiteSettingsWritePolicies }) => { seen.push(required); return { value: null, revisionSeq: 7 }; },
}));

test("writeFormDeliveryBindings saves the cleaned list through the host settings chokepoint", async () => {
  const { writeFormDeliveryBindings } = await import("../form-delivery-write.js");
  const deps = {} as SetValueRequired["deps"]; // never read: the chokepoint is a spy here
  const writePolicies: SiteSettingsWritePolicies = { dedicatedWriters: [] };
  const result = await writeFormDeliveryBindings({ writePolicies, deps, workspaceId: "ws-1", callerPrincipalId: "owner",
    value: [{ bindingId: "b1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {}, }] });
  assert.equal(result.revisionSeq, 7);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.deps, deps);
  assert.equal(seen[0]?.writePolicies, writePolicies);
  assert.deepEqual(seen[0]?.input, { namespace: "core.forms", key: "deliveryBindings", scope: "workspace", workspaceId: "ws-1", callerPrincipalId: "owner",
    value: [{ bindingId: "b1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {} }] });
});
