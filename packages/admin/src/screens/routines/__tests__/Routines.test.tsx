// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoutineRow } from "@jini-ai/core/contracts/site/routines";
import { projectRoutineRow } from "../project-routine-row.js";
import { useRoutinesController } from "../Routines.hooks.js";
import { RoutinesApiError, type RoutinesApi } from "../routines-api.js";

const row: RoutineRow = {
  id: "routine", name: "Digest", prompt: "Summarize", schedule: { kind: "hourly", minute: 15 },
  target: { mode: "create_each_run" }, skillId: null, agentId: null, model: null, creatorId: "owner", enabled: true,
  nextRunAt: null, revision: 3, createdAt: 1, updatedAt: 2,
  lastRun: { runId: "run", trigger: "scheduled", status: "running", startedAt: 1,
    catchUp: true, approvalState: "waiting", projectId: "project", conversationId: "chat", agentRunId: "agent" },
};

describe("routines", () => {
  it("projects Waiting for approval and Catch-up run together", () => {
    const view = projectRoutineRow({ row, locale: "en", t: ({ key }) => key });
    expect(view.badges).toEqual(["Catch-up run", "Waiting for approval"]);
    expect(view.outcomeLabel).toBe("Running");
  });

  it("reloads a stale revision without retrying the write", async () => {
    const api: RoutinesApi = {
      list: vi.fn().mockResolvedValueOnce({ state: "ready", routines: [row] })
        .mockResolvedValueOnce({ state: "ready", routines: [{ ...row, revision: 9 }] }),
      create: vi.fn(), remove: vi.fn(),
      update: vi.fn().mockRejectedValue(new RoutinesApiError({ message: "Changed", status: 409, reason: "ROUTINE_CHANGED", errorId: null })),
    };
    const focus = { subscribe: () => () => {} };
    const timers = { setInterval: vi.fn(), clearInterval: vi.fn() };
    const { result } = renderHook(() => useRoutinesController({ api, visible: true, focus, timers }));
    await waitFor(() => expect(result.current.view.kind).toBe("ready"));
    await act(async () => { expect(await result.current.setEnabled({ row, enabled: false })).toBe(false); });
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(result.current.notice?.key).toBe("stale");
    expect(result.current.view).toEqual({ kind: "ready", routines: [{ ...row, revision: 9 }] });
  });
});
