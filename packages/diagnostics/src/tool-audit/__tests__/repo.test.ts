import { describe, expect, it } from "vitest";

import type { ToolAttemptEvent } from "@jini-ai/core/contracts/site/daemon-tool-audit";
import { MAX_ROWS_PER_WORKSPACE, MAX_VISITOR_ROWS_PER_WORKSPACE, SqlToolAttemptAuditSink } from "../repo.js";
import { createSqlHarness } from "./sql-harness.js";

const tables = { toolAttempts: "host_attempts" };
const event = (overrides: Partial<ToolAttemptEvent> = {}): ToolAttemptEvent => ({
  attemptId: "attempt-1",
  executionId: "exec-1",
  workspaceId: "ws-1",
  runId: "run-1",
  toolId: "pages_read_html",
  principalId: "admin",
  phase: "requested",
  at: "2026-01-01T00:00:00.000Z",
  detail: "legacy",
  ...overrides,
});

describe("SqlToolAttemptAuditSink error reporter seam", () => {
  it("reports a failed write to the injected reporter with the original error and never rejects", async () => {
    const harness = createSqlHarness();
    const failure = new Error("audit storage unavailable");
    const reported: unknown[] = [];
    const kernel = { ...harness.kernel, run: async () => { throw failure; } };
    const sink = new SqlToolAttemptAuditSink({ kernel, tables, onError: ({ error }) => { reported.push(error); } });
    await expect(sink.append(event())).resolves.toBeUndefined();
    await expect(sink.appendCommitted(event())).resolves.toBe(false);
    expect(reported).toEqual([failure, failure]);
    expect(reported[0]).toBe(failure);
  });

  it("keeps the committed insert when the retention step fails, reporting that failure", async () => {
    const harness = createSqlHarness();
    const failure = new Error("cutoff failed");
    const reported: unknown[] = [];
    let calls = 0;
    const kernel = { ...harness.kernel, run: async <T>(fn: Parameters<typeof harness.kernel.run<T>>[0]) => {
      calls += 1;
      if (calls === 2) throw failure;
      return harness.kernel.run(fn);
    } };
    const sink = new SqlToolAttemptAuditSink({ kernel, tables, onError: ({ error }) => { reported.push(error); } }, { pruneCheckInterval: 1 });
    await expect(sink.appendCommitted(event())).resolves.toBe(true);
    expect(reported).toEqual([failure]);
  });
});

describe("SqlToolAttemptAuditSink writes", () => {
  it("inserts every column into the host table; explicit detail wins, null clears, absent falls back", async () => {
    const harness = createSqlHarness();
    const sink = new SqlToolAttemptAuditSink({ kernel: harness.kernel, tables, onError: () => {} });
    await expect(sink.appendCommitted(event(), { detail: "explicit" })).resolves.toBe(true);
    await sink.append(event({ attemptId: "cleared" }), { detail: null });
    await sink.append(event({ attemptId: "legacy" }));
    const { detail: _legacy, ...withoutDetail } = event({ attemptId: "none", executionId: null });
    await sink.append(withoutDetail);
    expect(harness.statements[0]!.sql).toBe(
      'insert into "host_attempts" ("attempt_id", "execution_id", "workspace_id", "run_id", "tool_id", "principal_id", "phase", "at", "detail") values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(harness.statements[0]!.parameters).toEqual(["attempt-1", "exec-1", "ws-1", "run-1", "pages_read_html", "admin", "requested", "2026-01-01T00:00:00.000Z", "explicit"]);
    expect(harness.statements.map((s) => s.parameters[8])).toEqual(["explicit", null, "legacy", null]);
    expect(harness.statements[3]!.parameters[1]).toBeNull();
  });
});

describe("SqlToolAttemptAuditSink retention", () => {
  it("defaults: the documented caps, and the first prune check on the 256th append", async () => {
    expect(MAX_ROWS_PER_WORKSPACE).toBe(50_000);
    expect(MAX_VISITOR_ROWS_PER_WORKSPACE).toBe(20_000);
    const harness = createSqlHarness();
    const sink = new SqlToolAttemptAuditSink({ kernel: harness.kernel, tables, onError: () => {} });
    for (let i = 0; i < 255; i++) await sink.append(event());
    expect(harness.statements.some((s) => s.sql.startsWith("select"))).toBe(false);
    await sink.append(event());
    expect(harness.statements.at(-1)!.sql).toBe('select "id" from "host_attempts" where "workspace_id" = ? and "principal_id" != ? order by "id" desc limit ? offset ?');
    expect(harness.statements.at(-1)!.parameters).toEqual(["ws-1", "anonymous-visitor", 1, MAX_ROWS_PER_WORKSPACE - 1]);
  });

  it("deletes below the cutoff per bucket: visitors by their own cap, administrators excluding visitors", async () => {
    const harness = createSqlHarness();
    const sink = new SqlToolAttemptAuditSink({ kernel: harness.kernel, tables, onError: () => {} },
      { maxRowsPerWorkspace: 3, maxVisitorRowsPerWorkspace: 2, pruneCheckInterval: 1 });
    harness.queue.push([], [{ id: 7 }]);
    await sink.append(event({ principalId: "anonymous-visitor" }));
    expect(harness.statements.slice(1).map((s) => [s.sql, s.parameters])).toEqual([
      ['select "id" from "host_attempts" where "workspace_id" = ? and "principal_id" = ? order by "id" desc limit ? offset ?', ["ws-1", "anonymous-visitor", 1, 1]],
      ['delete from "host_attempts" where "workspace_id" = ? and "principal_id" = ? and "id" < ?', ["ws-1", "anonymous-visitor", 7]],
    ]);
    harness.statements.length = 0;
    harness.queue.push([], [{ id: 9 }]);
    await sink.append(event());
    expect(harness.statements.slice(1).map((s) => s.parameters)).toEqual([["ws-1", "anonymous-visitor", 1, 2], ["ws-1", "anonymous-visitor", 9]]);
    expect(harness.statements[2]!.sql).toContain('"principal_id" != ?');
  });

  it("issues no delete when the bucket is under its cap", async () => {
    const harness = createSqlHarness();
    const sink = new SqlToolAttemptAuditSink({ kernel: harness.kernel, tables, onError: () => {} }, { pruneCheckInterval: 2 });
    await sink.append(event());
    await sink.append(event({ workspaceId: "ws-2" }));
    await sink.append(event());
    expect(harness.statements.map((s) => s.sql.split(" ")[0])).toEqual(["insert", "insert", "insert", "select"]);
  });
});
