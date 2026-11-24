import { describe, expect, it } from "vitest";

import type { ToolAttemptEvent } from "@jini-ai/core/contracts/site/daemon-tool-audit";
import { createInMemoryToolAttemptAuditSink } from "../repo.memory.js";

const event = (overrides: Partial<ToolAttemptEvent> = {}): ToolAttemptEvent => ({
  attemptId: "attempt-1",
  executionId: "exec-1",
  workspaceId: "ws",
  runId: "run-1",
  toolId: "pages_read_html",
  principalId: "admin",
  phase: "requested",
  at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("createInMemoryToolAttemptAuditSink", () => {
  it("records events in append order on the live events array", async () => {
    const sink = createInMemoryToolAttemptAuditSink({});
    const live = sink.events;
    await sink.append(event({ phase: "requested" }));
    await sink.append(event({ phase: "completed" }));
    expect(live.map(entry => entry.phase)).toEqual(["requested", "completed"]);
    expect(sink.events).toBe(live);
  });

  it("keeps a legacy event-shaped detail and lets an explicit optional detail override it", async () => {
    const sink = createInMemoryToolAttemptAuditSink({});
    await sink.append(event({ detail: "legacy" }));
    await sink.append(event({ detail: "legacy" }), { detail: "explicit" });
    expect(sink.events.map(entry => entry.detail)).toEqual(["legacy", "explicit"]);
  });

  it("evicts the oldest events once maxEvents is exceeded", async () => {
    const sink = createInMemoryToolAttemptAuditSink({}, { maxEvents: 2 });
    for (const attemptId of ["a", "b", "c"]) await sink.append(event({ attemptId }));
    expect(sink.events.map(entry => entry.attemptId)).toEqual(["b", "c"]);
  });

  it("rejects a maxEvents that is not a positive safe integer", () => {
    for (const maxEvents of [0, -1, 1.5, Number.NaN]) {
      expect(() => createInMemoryToolAttemptAuditSink({}, { maxEvents })).toThrow(new RangeError("maxEvents must be a positive safe integer"));
    }
    expect(() => createInMemoryToolAttemptAuditSink({}, { maxEvents: 1 })).not.toThrow();
  });
});
