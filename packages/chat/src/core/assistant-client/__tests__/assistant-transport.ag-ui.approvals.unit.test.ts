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
    expect(await Promise.all([
      approvals.answer({ exchangeId: "exchange", allow: true }),
      approvals.answer({ exchangeId: "exchange", allow: true }),
    ])).toEqual([true, true]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread", parentRunId: "parent",
      resume: [{ interruptId: "pause", status: "resolved", payload: "allow" }],
    }), {});
  });

  it("an expired resume shows the plain refusal once and never acknowledges a repeat as sent", async () => {
    let refuse!: (error: unknown) => void;
    const resume = vi.fn(() => new Promise<{ runId: string }>((_resolve, reject) => { refuse = reject; }));
    const onError = vi.fn();
    const approvals = createAgUiApprovalRelay({ ports: {
      resume, isAccepted: () => true, copy: { expired: "Expired", unsent: "Unsent" },
    } });
    const segment = approvals.beginTurn({ threadId: "thread", signal: new AbortController().signal,
      handlers: { onEvent: vi.fn(), onError, onDone: vi.fn() } });
    approvals.observe({ threadId: "thread", input: { threadId: "thread", runId: "parent" } as RunAgentInput,
      event: { type: "RUN_STARTED", runId: "parent" } });
    approvals.observe({ threadId: "thread", input: { threadId: "thread", runId: "parent" } as RunAgentInput,
      event: { type: "RUN_FINISHED", runId: "parent", outcome: { type: "interrupt",
        interrupts: [{ id: "pause", reason: "confirmation", metadata: { exchangeId: "exchange" } }] } } });
    segment.onDone([]);
    const fallback = vi.fn(async () => ({ content: [{ type: "text" as const, text: "fallback" }] }));
    const route = routeApprovalToolCall({ approvals, fallback, copy: { sent: "Answer sent", notSent: "Answer not sent" } });
    const call = { name: "approval", arguments: { __exchangeId: "exchange", decision: "confirm" } };
    const first = route(call);
    const concurrent = route(call);
    await Promise.resolve();
    refuse(Object.assign(new Error("refused"), { status: 400 }));
    const refusal = { isError: true, content: [{ type: "text", text: "Answer not sent" }] };
    expect(await first).toEqual(refusal);
    expect(await concurrent).toEqual(refusal);
    expect(await route(call)).toEqual(refusal);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error("Expired"));
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
