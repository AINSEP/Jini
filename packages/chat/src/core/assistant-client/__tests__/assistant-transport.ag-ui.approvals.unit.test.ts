import type { RunAgentInput } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";
import { createAgUiApprovalRelay, routeApprovalToolCall } from "../ag-ui-approval-relay.js";

describe("AG-UI parked approvals", () => {
  it("resumes one parked exchange once with its original parent run", async () => {
    const resume = vi.fn(async () => ({ runId: "resumed" }));
    const approvals = createAgUiApprovalRelay({ ports: {
      resume, isAccepted: () => false,
      copy: { expired: "Expired", unsent: "Unsent" },
    } });
    approvals.beginTurn({ threadId: "thread", signal: new AbortController().signal,
      handlers: { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn() } });
    approvals.observe({ threadId: "thread", input: { threadId: "thread", runId: "parent" } as RunAgentInput,
      event: { type: "RUN_FINISHED", runId: "parent", outcome: { type: "interrupt",
        interrupts: [{ id: "pause", reason: "confirmation", metadata: { exchangeId: "exchange" } }] } } });
    await Promise.all([
      approvals.answer({ exchangeId: "exchange", allow: true }),
      approvals.answer({ exchangeId: "exchange", allow: true }),
    ]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread", parentRunId: "parent",
      resume: [{ interruptId: "pause", status: "resolved", payload: "allow" }],
    }), {});
  });

  it("routes an unmatched exchange to the original fallback", async () => {
    const fallback = vi.fn(async () => ({ content: [{ type: "text" as const, text: "fallback" }] }));
    const answer = vi.fn(async () => true);
    const route = routeApprovalToolCall({ approvals: { answersExchange: () => false, answer }, fallback,
      copy: { sent: "Sent", notSent: "Not sent" } });
    const call = { name: "approval", arguments: { __exchangeId: "foreign", decision: "confirm" } };
    expect(await route(call)).toEqual({ content: [{ type: "text", text: "fallback" }] });
    expect(fallback).toHaveBeenCalledWith(call);
    expect(answer).not.toHaveBeenCalled();
  });
});
