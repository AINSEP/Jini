import { describe, expect, it, vi } from "vitest";
import type { PostRecord } from "../post.js";
import { withoutHeldAgentSchedule } from "../agent-hold.js";

const hold = "2026-10-10T12:00:00.000Z";
const rows: Pick<PostRecord, "createdByKind" | "publishAt">[] = [
  { createdByKind: "person", publishAt: "2026-10-10T13:00:00.000Z" },
  { createdByKind: "agent", publishAt: null },
  { createdByKind: "agent", publishAt: hold },
  { createdByKind: "agent", publishAt: "2026-10-10T13:00:00.000Z" },
];

describe("withoutHeldAgentSchedule", () => {
  it("keeps person, unscheduled and boundary rows with one workspace lookup", async () => {
    const heldSince = vi.fn(async () => hold);
    const result = await withoutHeldAgentSchedule({ workspaceId: "workspace", rows, agentHold: { heldSince } });
    expect(result).toEqual(rows.slice(0, 3));
    expect(heldSince).toHaveBeenCalledExactlyOnceWith({ workspaceId: "workspace" });
  });

  it("returns the original array without a reader", async () => {
    expect(await withoutHeldAgentSchedule({ workspaceId: "workspace", rows, agentHold: undefined })).toBe(rows);
  });

  it("returns the original array when the workspace has no hold", async () => {
    const heldSince = vi.fn(async () => null);
    expect(await withoutHeldAgentSchedule({ workspaceId: "workspace", rows, agentHold: { heldSince } })).toBe(rows);
    expect(heldSince).toHaveBeenCalledExactlyOnceWith({ workspaceId: "workspace" });
  });
});
