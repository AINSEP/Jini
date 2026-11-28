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
    const onDone = vi.fn();
    approvals.beginTurn({ threadId: "thread", signal: new AbortController().signal,
      handlers: { onEvent: vi.fn(), onError, onDone } });
    approvals.observe({ threadId: "thread", input: { threadId: "thread", runId: "parent" } as RunAgentInput,
      event: { type: "RUN_STARTED", runId: "parent" } });
    approvals.observe({ threadId: "thread", input: { threadId: "thread", runId: "parent" } as RunAgentInput,
      event: { type: "RUN_FINISHED", runId: "parent", outcome: { type: "interrupt",
        interrupts: [{ id: "pause", reason: "confirmation", metadata: { exchangeId: "exchange" } }] } } });
    // An accepted (durable) turn's segment never reports onDone at an interrupt: ag-ui-transport's
    // settleRunOnce leaves the one onDone to the checkpoint follower, which fires at the run's real end.
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
    expect(onDone).not.toHaveBeenCalled();
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

  describe("delivery-only turns, refusals and stop", () => {
    const parentInput = { threadId: "thread", runId: "parent" } as RunAgentInput;
    const interrupt = (exchangeId = "exchange") => ({ type: "RUN_FINISHED", runId: "parent", outcome: { type: "interrupt",
      interrupts: [{ id: "other", reason: "input" }, { id: "pause", reason: "confirmation", metadata: { exchangeId } }] } });
    function relay(resume: (...args: never[]) => Promise<{ runId: string }>) {
      const handlers = { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
      const approvals = createAgUiApprovalRelay({ ports: { resume: resume as never, isAccepted: () => false, copy: { expired: "Expired", unsent: "Unsent" } } });
      const segment = approvals.beginTurn({ threadId: "thread", signal: new AbortController().signal, handlers });
      return { approvals, segment, handlers };
    }
    const usage = (n: number) => ({ kind: "usage", inputTokens: n }) as never;
    const text = (value: string) => ({ kind: "text", text: value }) as never;

    it("holds a parked segment's end, and a non-400 resume failure says 'Unsent' then settles one transcript with the last usage", async () => {
      const { approvals, segment, handlers } = relay(async () => { throw new Error("HTTP 503", { cause: new Error("daemon detail") }); });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([text("a"), usage(1)]);
      expect(handlers.onDone).not.toHaveBeenCalled();
      expect(await approvals.answer({ exchangeId: "exchange", allow: false })).toBe(false);
      expect(handlers.onError).toHaveBeenCalledExactlyOnceWith(new Error("Unsent"));
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("a"), usage(1)]);
      // Settled: the exchange is forgotten and later frames are dropped.
      expect(approvals.answersExchange({ exchangeId: "exchange" })).toBe(false);
      expect(await approvals.answer({ exchangeId: "exchange", allow: true })).toBe(false);
      segment.onEvent(text("late"));
      segment.onError(new Error("late"));
      segment.onDone([]);
      expect(handlers.onEvent).not.toHaveBeenCalled();
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(handlers.onDone).toHaveBeenCalledTimes(1);
    });

    it("an 'HTTP 400' anywhere in the cause chain is the expiry refusal", async () => {
      const { approvals, segment, handlers } = relay(async () => { throw new Error("resume failed", { cause: new Error("POST /runs: HTTP 400 Bad Request") }); });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([]);
      expect(await approvals.answer({ exchangeId: "exchange", allow: true })).toBe(false);
      expect(handlers.onError).toHaveBeenCalledExactlyOnceWith(new Error("Expired"));
    });

    it("a resumed segment answers the pause, sends a deny decision, and its own end settles the carried transcript", async () => {
      const resume = vi.fn(async () => ({ runId: "resumed" }));
      const { approvals, segment, handlers } = relay(resume);
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([usage(1), text("before")]);
      expect(await approvals.answer({ exchangeId: "exchange", allow: false })).toBe(true);
      expect(resume).toHaveBeenCalledWith(expect.objectContaining({ parentRunId: "parent", resume: [{ interruptId: "pause", status: "resolved", payload: "deny" }],
        input: { history: [], signal: expect.any(AbortSignal), conversationId: "thread" } }), {});
      const resumedInput = { threadId: "thread", runId: "resumed", parentRunId: "parent" } as RunAgentInput;
      approvals.observe({ threadId: "thread", input: resumedInput, event: { type: "RUN_STARTED", runId: "resumed" } });
      segment.onDone([usage(5), text("after")]);
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("before"), usage(5), text("after")]);
      expect(handlers.onError).not.toHaveBeenCalled();
    });

    it("stop releases the bound run: returns the resumed run id and settles a turn whose segment already ended", async () => {
      const { approvals, segment, handlers } = relay(async () => ({ runId: "resumed" }));
      approvals.bindRun({ threadId: "thread", runId: "parent" });
      approvals.bindRun({ threadId: "unknown", runId: "stray" });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([text("held")]);
      expect(await approvals.answer({ exchangeId: "exchange", allow: true })).toBe(true);
      expect(approvals.release({ runId: "stray" })).toBeUndefined();
      expect(approvals.release({ runId: "parent" })).toBe("resumed");
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("held")]);
      expect(approvals.answersExchange({ exchangeId: "exchange" })).toBe(false);
      expect(approvals.release({ runId: "parent" })).toBeUndefined();
    });

    it("parks nothing for a finish without a confirmation interrupt, or for an unknown thread", async () => {
      const { approvals, segment, handlers } = relay(async () => ({ runId: "resumed" }));
      approvals.observe({ threadId: "thread", input: parentInput, event: { type: "RUN_FINISHED", runId: "parent", outcome: { type: "interrupt", interrupts: "none" } } });
      approvals.observe({ threadId: "thread", input: parentInput, event: { type: "RUN_FINISHED", runId: "parent", outcome: { type: "success" } } });
      approvals.observe({ threadId: "elsewhere", input: parentInput, event: interrupt("foreign") });
      approvals.observe({ threadId: "thread", input: parentInput, event: null });
      expect(approvals.answersExchange({ exchangeId: "foreign" })).toBe(false);
      segment.onDone([text("done")]);
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("done")]);
    });

    it("a live segment forwards its events and errors to the turn until it settles", () => {
      const { segment, handlers } = relay(async () => ({ runId: "resumed" }));
      segment.onEvent(text("live"));
      segment.onError(new Error("segment failed"));
      expect(handlers.onEvent).toHaveBeenCalledExactlyOnceWith(text("live"));
      expect(handlers.onError).toHaveBeenCalledExactlyOnceWith(new Error("segment failed"));
    });

    it("a refused resume settles the held turn once, so a later stop does not deliver a second transcript", async () => {
      const { approvals, segment, handlers } = relay(async () => { throw new Error("HTTP 503"); });
      approvals.bindRun({ threadId: "thread", runId: "parent" });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([text("held")]);
      expect(await approvals.answer({ exchangeId: "exchange", allow: true })).toBe(false);
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("held")]);
      expect(approvals.release({ runId: "parent" })).toBeUndefined();
      expect(handlers.onDone).toHaveBeenCalledTimes(1);
    });

    it("a resume refused after stop already settled the turn reports no refusal", async () => {
      let reject!: (error: unknown) => void;
      const { approvals, segment, handlers } = relay(() => new Promise<{ runId: string }>((_resolve, fail) => { reject = fail; }));
      approvals.bindRun({ threadId: "thread", runId: "parent" });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      segment.onDone([text("held")]);
      const answered = approvals.answer({ exchangeId: "exchange", allow: true });
      expect(approvals.release({ runId: "parent" })).toBeUndefined();
      expect(handlers.onDone).toHaveBeenCalledExactlyOnceWith([text("held")]);
      reject(new Error("HTTP 503"));
      expect(await answered).toBe(false);
      expect(handlers.onError).not.toHaveBeenCalled();
      expect(handlers.onDone).toHaveBeenCalledTimes(1);
    });

    it("a second refused exchange in the same turn shows no second refusal", async () => {
      const { approvals, handlers } = relay(async () => { throw new Error("HTTP 503"); });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt("first") });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt("second") });
      expect(await approvals.answer({ exchangeId: "first", allow: true })).toBe(false);
      expect(await approvals.answer({ exchangeId: "second", allow: false })).toBe(false);
      expect(handlers.onError).toHaveBeenCalledExactlyOnceWith(new Error("Unsent"));
      expect(handlers.onDone).not.toHaveBeenCalled();
    });

    it("a durable turn's resume segment frames never reach the turn: its follower renders the resumed run", async () => {
      const handlers = { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
      const resume = vi.fn(async ({ handlers: segment }: { handlers: { onEvent: (e: never) => void; onError: (e: Error) => void; onDone: (f: never[]) => void } }) => {
        segment.onEvent(text("duplicate"));
        segment.onError(new Error("segment noise"));
        segment.onDone([text("duplicate")]);
        return { runId: "resumed" };
      });
      const approvals = createAgUiApprovalRelay({ ports: { resume: resume as never, isAccepted: ({ runId }) => runId === "canon", copy: { expired: "Expired", unsent: "Unsent" } } });
      approvals.beginTurn({ threadId: "thread", signal: new AbortController().signal, handlers });
      approvals.observe({ threadId: "thread", input: parentInput, event: { type: "RUN_STARTED", runId: "canon" } });
      approvals.observe({ threadId: "thread", input: parentInput, event: interrupt() });
      expect(await approvals.answer({ exchangeId: "exchange", allow: true })).toBe(true);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(handlers.onEvent).not.toHaveBeenCalled();
      expect(handlers.onError).not.toHaveBeenCalled();
      expect(handlers.onDone).not.toHaveBeenCalled();
    });

    it("routes a cancel decision as deny and acknowledges a sent answer", async () => {
      const answer = vi.fn(async () => true);
      const fallback = vi.fn();
      const route = routeApprovalToolCall({ approvals: { answersExchange: () => true, answer }, fallback, copy: { sent: "Sent", notSent: "Not sent" } });
      expect(await route({ name: "approval", arguments: { __exchangeId: "exchange", decision: "cancel" } }))
        .toEqual({ isError: false, content: [{ type: "text", text: "Sent" }] });
      expect(answer).toHaveBeenCalledWith({ exchangeId: "exchange", allow: false }, {});
      const noId = { name: "approval", arguments: { decision: "confirm" } };
      await route(noId);
      expect(fallback).toHaveBeenCalledWith(noId);
    });
  });
});
