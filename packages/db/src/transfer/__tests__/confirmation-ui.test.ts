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

it("prints original timestamp text when unavailable and uses singular row counts without revealing credentials", () => {
  const plan: DatabaseTransferPlan = {
    planId: "plan", principalId: "principal", workspaceId: "workspace", expiresAtMs: 100,
    connectionString: "private-credential-do-not-display", destination: { host: "db.example", port: "5432", database: "copy", user: "writer" },
    replaces: "prior copy time unknown", snapshot: Buffer.alloc(0), snapshotAt: "capture time unknown",
    site: "site", schema: "copy_area", tableCount: 2, rowCount: 1,
    leftOut: [{ table: "keys", reason: "private", rows: 1 }, { table: "sessions", reason: "private", rows: 0 }],
  };
  const confirmation = describeTransferApproval({ plan });
  expect(confirmation).toEqual({
    toolId: "database_transfer_run", errorCode: "DATABASE_TRANSFER",
    title: "Copy this site's data to copy on db.example?",
    description: "Your site keeps running on its built-in storage. This only makes a copy.",
    details: [
      { label: "Destination", value: "copy on db.example" },
      { label: "Copies", value: "2 tables, 1 row, as of capture time unknown" },
      { label: "Goes into", value: 'A private area named "copy_area". Nothing else in that database is touched.' },
      { label: "Replaces", value: "The earlier copy from prior copy time unknown" },
      { label: "Left out", value: "Logins and saved keys (1 row). Photos and files stay where they are." },
    ],
    warning: "The earlier copy from prior copy time unknown is replaced once this copy has been checked.",
    confirmLabel: "Copy", cancelLabel: "Cancel",
  });
  expect(JSON.stringify(confirmation)).not.toContain(plan.connectionString);
});
