import { describe, expect, it } from "vitest";
import { checkExistence, type ApplyRowStep, type InspectedRow } from "../apply-row.js";
import type { PublishContentOutcomeRow } from "../plan-rows.js";

const step = (outcome: string, current: InspectedRow | null) =>
  ({ row: { entityType: "post", entityId: "p1", outcome, writes: true } as unknown as PublishContentOutcomeRow, current }) as unknown as ApplyRowStep;
const existing = { version: 1, hash: "h" } as unknown as InspectedRow;

describe("checkExistence", () => {
  it("downgrades a created row whose destination row now exists", () => {
    expect(checkExistence({ step: step("created", existing) })?.row).toMatchObject({
      outcome: "conflict", writes: false, reason: "post 'p1' was created on the destination between plan and apply",
    });
  });
  it("downgrades an applied row whose destination row is now gone", () => {
    expect(checkExistence({ step: step("applied", null) })?.row.reason).toBe("post 'p1' was removed from the destination between plan and apply");
  });
  it("lets agreeing rows through", () => {
    expect(checkExistence({ step: step("created", null) })).toBeNull();
    expect(checkExistence({ step: step("applied", existing) })).toBeNull();
  });
});
