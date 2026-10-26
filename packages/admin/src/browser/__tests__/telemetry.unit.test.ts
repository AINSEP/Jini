import { describe, expect, it } from "vitest";
import { createBrowserTelemetry, type BrowserTelemetryPayload } from "../telemetry.js";

/** Engine over a manual clock and timer queue; `sent` is everything that would have been POSTed. */
function harness(options?: { maxErrorsPerMinute?: number }) {
  const sent: BrowserTelemetryPayload[] = [];
  let now = 0;
  let pending: (() => void) | null = null;
  const telemetry = createBrowserTelemetry({
    send: async (payload) => { sent.push(payload); },
    nowMs: () => now,
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
  }, options);
  return {
    telemetry, sent,
    advance: (ms: number) => { now += ms; },
    fireTimer: () => { const fn = pending; pending = null; fn?.(); },
  };
}


describe("browser telemetry engine", () => {
  it("sends nothing before sign-in", () => {
    const h = harness();
    h.telemetry.setRoute("/admin/posts");
    h.telemetry.reportError({ error: new Error("early") });
    h.fireTimer();
    expect(h.sent).toEqual([]);
  });

  it("dedupes the same error from the same place and caps errors per minute", () => {
    const h = harness({ maxErrorsPerMinute: 3 });
    h.telemetry.setSignedIn(true);
    const same = new Error("same");
    for (let i = 0; i < 5; i += 1) h.telemetry.reportError({ error: same });
    expect(h.sent).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) h.telemetry.reportError({ error: new Error(`distinct ${i}`) });
    expect(h.sent).toHaveLength(3);
    h.advance(60_000);
    h.telemetry.reportError({ error: new Error("next minute") });
    expect(h.sent).toHaveLength(4);
  });

  it("carries the current route template, never dumps a non-Error value, and truncates to the server caps", () => {
    const h = harness();
    h.telemetry.setSignedIn(true);
    h.telemetry.setRoute("/admin/posts/:postId");
    h.telemetry.reportError({ error: { email: "jane@example.com", password: "hunter2" } });
    h.telemetry.reportError({ error: new Error("x".repeat(5_000)), componentStack: "c".repeat(9_000) });
    const [plain, long] = h.sent as Extract<BrowserTelemetryPayload, { type: "error" }>[];
    expect(plain).toEqual({ type: "error", message: "Non-Error thrown (object)", stack: "", route: "/admin/posts/:postId" });
    expect(JSON.stringify(h.sent)).not.toContain("jane@example.com");
    expect(long!.message).toHaveLength(1_000);
    expect(long!.stack.length).toBeLessThanOrEqual(8_000);
    expect(long!.componentStack).toHaveLength(4_000);
  });

  it("never throws, even when sending throws or rejects", () => {
    const throwing = createBrowserTelemetry({
      send: () => { throw new Error("offline"); }, nowMs: () => 0, setTimer: () => { throw new Error("no timers"); }, clearTimer: () => {},
    });
    throwing.setSignedIn(true);
    expect(() => throwing.setRoute("/admin")).not.toThrow();
    expect(() => throwing.reportError({ error: new Error("a") })).not.toThrow();
    const rejecting = createBrowserTelemetry({ send: () => Promise.reject(new Error("429")), nowMs: () => 0, setTimer: () => 0, clearTimer: () => {} });
    rejecting.setSignedIn(true);
    expect(() => rejecting.reportError({ error: new Error("b") })).not.toThrow();
  });

  it("debounces page views and does not repeat the same route", () => {
    const h = harness();
    h.telemetry.setSignedIn(true);
    h.telemetry.setRoute("/admin/posts");
    h.telemetry.setRoute("/admin/posts/:postId");
    h.fireTimer();
    h.telemetry.setRoute("/admin/posts/:postId");
    h.fireTimer();
    expect(h.sent).toEqual([{ type: "pageview", route: "/admin/posts/:postId" }]);
  });
});


it("uses a host-supplied initial route and drops pending views after sign-out", () => {
  const sent: BrowserTelemetryPayload[] = [];
  let fire = () => {};
  const telemetry = createBrowserTelemetry({ send: async payload => { sent.push(payload); }, nowMs: () => 0,
    setTimer: fn => { fire = fn; return 1; }, clearTimer: () => {},
  }, { initialRoute: "/console" });
  telemetry.setSignedIn(true);
  const error = new Error("initial");
  error.stack = "Error: initial";
  telemetry.reportError({ error });
  telemetry.setRoute("/console/settings");
  telemetry.setSignedIn(false);
  fire();
  expect(sent).toEqual([{ type: "error", message: "initial", stack: "Error: initial", route: "/console" }]);
});
