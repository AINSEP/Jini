import { expect, it } from "vitest";
import { describeTransferApproval } from "../confirmation-ui.js";
import type { DatabaseTransferPlan } from "../../tools/plan-store.js";

it("replacement warning only for a replacement", () => {
  const plan: DatabaseTransferPlan = {
    planId: "plan", principalId: "principal", workspaceId: "workspace", expiresAtMs: 100,
    connectionString: "private", destination: { host: "db.example", port: "5432", database: "copy", user: "writer" },
    replaces: null, snapshot: Buffer.alloc(0), snapshotAt: "2026-09-27T15:41:00Z", site: "site", schema: "private",
    tableCount: 1, rowCount: 2, leftOut: [],
  };
  expect(describeTransferApproval({ plan })).not.toHaveProperty("warning");
  expect(describeTransferApproval({ plan: { ...plan, replaces: plan.snapshotAt } }).warning).toContain("is replaced once this copy has been checked.");
});
