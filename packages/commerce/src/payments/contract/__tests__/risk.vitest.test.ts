import { describe, expect, test } from "vitest";
import { assessPreChargeRisk, noopRiskPort, type PreChargeRiskInput, type PreChargeRiskPort, type RiskFailPolicy } from "../risk.js";

const input: PreChargeRiskInput = {
  scope: { workspaceId: "ws", siteId: "s", providerId: "p", providerAccountId: "a", mode: "test" },
  amount: { minorUnits: 100, currency: "USD" },
  paymentId: "pay_1",
};

/** A manual timer: the test decides when the deadline fires. */
function manualTimer() {
  const state = { fire: (): void => undefined, cancelled: false, ms: -1 };
  return {
    state,
    setTimer: (fn: () => void, ms: number) => {
      state.fire = fn;
      state.ms = ms;
      return { cancel: () => { state.cancelled = true; } };
    },
  };
}

function gate(port: PreChargeRiskPort, failPolicy: RiskFailPolicy = "closed") {
  const timer = manualTimer();
  return { timer, run: () => assessPreChargeRisk({ deps: { port, deadlineMs: 250, failPolicy, setTimer: timer.setTimer }, input }) };
}

describe("assessPreChargeRisk", () => {
  test("the no-op port allows and the timer is cancelled", async () => {
    const { timer, run } = gate(noopRiskPort);
    expect(await run()).toEqual({ verdict: "allow", reasons: [], fallback: false });
    expect(timer.state.cancelled).toBe(true);
    expect(timer.state.ms).toBe(250);
  });

  test("a port verdict is passed through with its reasons", async () => {
    const { run } = gate({ assess: async () => ({ verdict: "review", reasons: ["velocity.party"] }) });
    expect(await run()).toEqual({ verdict: "review", reasons: ["velocity.party"], fallback: false });
  });

  test.each([
    ["open", "allow"],
    ["closed", "deny"],
    ["review", "review"],
  ] as const)("deadline under fail-%s resolves %s and aborts the port", async (policy, verdict) => {
    let signal: AbortSignal | undefined;
    const { timer, run } = gate({ assess: (_r, o) => { signal = o?.signal; return new Promise(() => undefined); } }, policy);
    const pending = run();
    await Promise.resolve();
    await Promise.resolve();
    timer.state.fire();
    expect(await pending).toEqual({ verdict, reasons: ["risk.deadline"], fallback: true });
    expect(signal?.aborted).toBe(true);
  });

  test("a rejecting port resolves through the fail policy", async () => {
    const { run } = gate({ assess: async () => { throw new Error("down"); } }, "open");
    expect(await run()).toEqual({ verdict: "allow", reasons: ["risk.error"], fallback: true });
  });

  test("a synchronously throwing port is caught too", async () => {
    const { run } = gate({ assess: () => { throw new Error("sync"); } });
    expect(await run()).toEqual({ verdict: "deny", reasons: ["risk.error"], fallback: true });
  });

  test.each([
    ["an unknown verdict", { verdict: "maybe", reasons: [] }],
    ["missing reasons", { verdict: "allow" }],
    ["null", null],
  ])("%s is malformed and uses the fail policy", async (_name, answer) => {
    const { run } = gate({ assess: async () => answer as never }, "review");
    expect(await run()).toEqual({ verdict: "review", reasons: ["risk.malformed"], fallback: true });
  });
});
