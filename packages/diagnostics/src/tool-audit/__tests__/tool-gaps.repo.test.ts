import { describe, expect, it } from "vitest";

import type { ToolGapEntry } from "@jini-ai/core/contracts/site/daemon-tool-audit";
import { createToolGapReader } from "../tool-gaps.repo.js";
import { createSqlHarness } from "./sql-harness.js";

const entry = (id: string): ToolGapEntry => ({ type: "tool_gap", id, at: "2026-01-01T00:00:00.000Z", site: "s", chatId: "c",
  runId: "r", provider: "p", toolUsed: "Bash", summary: "ls", gapLine: null });

function reader() {
  const harness = createSqlHarness();
  const decoded: Array<string | null> = [];
  const toolGaps = createToolGapReader({
    kernel: harness.kernel, tables: { toolAttempts: "host_attempts" }, toolGapAuditId: "gap_marker",
    decodeToolGapEntry: ({ json }) => { decoded.push(json); return json === "bad" ? null : entry(json ?? "null"); },
  });
  return { harness, decoded, toolGaps };
}

describe("createToolGapReader", () => {
  it("reads the newest revision per attempt from the host table with the injected marker, skipping undecodable rows", async () => {
    const { harness, decoded, toolGaps } = reader();
    harness.queue.push([{ detail: "a" }, { detail: "bad" }, { detail: null }]);
    const entries = await toolGaps.list({ workspaceId: "w", principalId: "owner" });
    expect(entries.map((e) => e.id)).toEqual(["a", "null"]);
    expect(decoded).toEqual(["a", "bad", null]);
    expect(harness.statements[0]!.sql).toBe('select "detail" from "host_attempts" where "id" in (select max("id") as "latest_id" from "host_attempts" where "workspace_id" = ? and "principal_id" = ? and "tool_id" = ? group by "attempt_id") order by "id" desc limit ?');
    expect(harness.statements[0]!.parameters).toEqual(["w", "owner", "gap_marker", 100]);
  });

  it("clamps the limit to 1..200 and falls back to 100 when it is not finite", async () => {
    const { harness, toolGaps } = reader();
    for (const limit of [0, 500, 7.9, Number.NaN, Number.POSITIVE_INFINITY]) await toolGaps.list({ workspaceId: "w", principalId: "o" }, { limit });
    expect(harness.statements.map((s) => s.parameters.at(-1))).toEqual([1, 200, 7, 100, 100]);
  });
});
