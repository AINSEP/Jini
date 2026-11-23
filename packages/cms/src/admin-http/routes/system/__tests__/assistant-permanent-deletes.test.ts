import { describe, expect, it } from "vitest";

import { createOwnerGrantRoutes } from "../assistant-owner-grant.js";
import { ASSISTANT_PERMANENT_DELETES_PATH, assistantPermanentDeletesGrant, type AssistantPermanentDeletesRouteDeps } from "../assistant-permanent-deletes.js";
import { baseDeps, invoke, refusalOf } from "../../settings/__tests__/helpers.js";

const TOOLS = ["delete_a", "delete_b", "delete_c"];
const DEPS: AssistantPermanentDeletesRouteDeps = {
  grant: { namespace: "test.deletes", key: "policy", writeReason: "TEST owner only" },
  permanentDeleteToolIds: TOOLS,
  readPolicy: async () => ({ enabled: false, allowedToolIds: [] }),
};
const INVALID = { status: 400, body: { error: "allowedToolIds must contain unique ids from the 3 supported permanent delete tools. Unknown and forbidden ids are rejected.", code: "VALIDATION_ERROR" } };

describe("assistant permanent-deletes grant", () => {
  it("pins the path, the injected coordinates and the acknowledged (default) workspace policy", () => {
    const policy = assistantPermanentDeletesGrant(DEPS);
    expect(ASSISTANT_PERMANENT_DELETES_PATH).toBe("/api/admin/v1/workspaces/:workspaceId/system/assistant-permanent-deletes");
    expect([policy.namespace, policy.key, policy.writeReason, policy.requireAcknowledgment, policy.scope]).toEqual(["test.deletes", "policy", "TEST owner only", undefined, undefined]);
    expect(policy.validationError).toBe("enabled must be a boolean; enabling permanent deletes requires riskAcknowledged: true.");
  });

  it("parse rejects the whole selection: unknown keys, unknown, duplicate or too many ids, non-arrays", async () => {
    const { parse } = assistantPermanentDeletesGrant(DEPS);
    for (const body of [
      { enabled: true, allowedToolIds: ["delete_a"], extra: 1 }, { enabled: true, allowedToolIds: ["nope"] },
      { enabled: true, allowedToolIds: ["delete_a", "delete_a"] }, { enabled: true, allowedToolIds: [...TOOLS, "delete_a"] },
      { enabled: true, allowedToolIds: "delete_a" }, { enabled: true },
    ]) {
      expect(await refusalOf(() => parse({ body }))).toEqual(INVALID);
    }
    const ids = ["delete_b", "delete_a"];
    const parsed = parse({ body: { enabled: true, allowedToolIds: ids, riskAcknowledged: true } });
    expect(parsed).toEqual({ enabled: true, allowedToolIds: ["delete_b", "delete_a"] });
    expect(parsed.allowedToolIds).not.toBe(ids);
  });

  it("stores exactly enabled + allowedToolIds and reads through the injected policy reader", async () => {
    const policy = assistantPermanentDeletesGrant(DEPS);
    expect(policy.value({ settings: { enabled: true, allowedToolIds: ["delete_c"] } })).toEqual({ enabled: true, allowedToolIds: ["delete_c"] });
    const writes: unknown[] = [];
    const routes = createOwnerGrantRoutes({ path: ASSISTANT_PERMANENT_DELETES_PATH, policy });
    const deps = { ...baseDeps(), ownerPrincipalId: Promise.resolve("principal-1"), clock: { nowIso: () => "t" },
      writeSetting: async ({ input }: { input: { key: string } }) => { writes.push(input.key); return { revisionSeq: 3 }; } };
    expect(await invoke(routes.get, { deps })).toEqual({ enabled: false, allowedToolIds: [], canEdit: true });
    expect(await refusalOf(() => invoke(routes.put, { deps, body: { enabled: true, allowedToolIds: ["delete_a"] } }))).toEqual({ status: 400, body: { error: policy.validationError, code: "VALIDATION_ERROR" } });
    expect(await invoke(routes.put, { deps, body: { enabled: true, allowedToolIds: ["delete_a"], riskAcknowledged: true } })).toEqual({ enabled: true, allowedToolIds: ["delete_a"], canEdit: true, revisionSeq: 3 });
    expect(writes).toEqual(["riskAcknowledgment", "policy"]);
  });
});
