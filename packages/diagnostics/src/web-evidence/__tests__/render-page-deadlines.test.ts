/** One fake clock drives the work budget, its timers and the hard stop of renderPage: no real browser, no module mocks. */
import { describe, expect, it } from "vitest";
import { renderPage, type RenderBrowser, type RenderPage, type RenderSession } from "../render-page.js";
import { PageWorkTimeout } from "../page-work-budget.js";
import { FakeCaptureClock } from "../testing/fake-clock.js";

const URL_UNDER_TEST = "https://site.example/";
const never = (): Promise<never> => new Promise(() => {});

interface Scenario {
  /** Clock time at which the navigation commits; `undefined` means it never does. */
  commitsAtMs?: number;
  /** The load-state wait never resolves. */
  loadStalls?: boolean;
}

function fixture(clock: FakeCaptureClock, { commitsAtMs, loadStalls = false }: Scenario) {
  const sleep = (ms: number) => new Promise<void>(resolve => clock.setTimeout(resolve, ms));
  const counts = { contextClosed: 0, consumed: 0 };
  const page: RenderPage = {
    goto: async () => { if (commitsAtMs === undefined) return never(); await sleep(commitsAtMs - clock.now()); return { status: () => 200, url: () => URL_UNDER_TEST }; },
    waitForTimeout: sleep,
    ...(loadStalls ? { waitForLoadState: () => never() } : {}),
    evaluate: async () => undefined, title: async () => "Fixture", url: () => URL_UNDER_TEST,
  };
  const browser: RenderBrowser = {
    newContext: async () => ({ newPage: async () => page, route: async () => {}, close: async () => { counts.contextClosed += 1; } }),
    close: async () => {},
  };
  return { browser, counts };
}

interface Outcome { state: "pending" | "resolved" | "rejected"; at?: number; value?: unknown; error?: unknown }

/** Start a capture and record when and how it settled, in clock time. */
function capture(clock: FakeCaptureClock, scenario: Scenario, options: Parameters<typeof renderPage>[1] = {}) {
  const { browser, counts } = fixture(clock, scenario);
  const sessions: RenderSession[] = [];
  const outcome: Outcome = { state: "pending" };
  void renderPage({ browser, url: URL_UNDER_TEST, consume: async session => { counts.consumed += 1; sessions.push(session); return "captured"; } },
    { timeoutMs: 20_000, clock, ...options })
    .then(value => Object.assign(outcome, { state: "resolved", at: clock.now(), value }),
      error => Object.assign(outcome, { state: "rejected", at: clock.now(), error }));
  return { outcome, counts, sessions };
}

/** Close is requested by the abort listener and again by the final release (it is idempotent), so "at least once". */
function expectClosedWithoutConsuming(counts: { contextClosed: number; consumed: number }): void {
  expect(counts.contextClosed).toBeGreaterThanOrEqual(1);
  expect(counts.consumed).toBe(0);
}

/** A caller cancel scheduled on the same clock. Scheduled before the capture starts, it wins a tie. */
function cancelAt(clock: FakeCaptureClock, ms: number) {
  const controller = new AbortController();
  const reason = new Error(`caller cancelled at ${ms}`);
  clock.setTimeout(() => controller.abort(reason), ms);
  return { signal: controller.signal, reason };
}

describe("renderPage deadlines today (no soft deadline)", () => {
  it("fails with PageWorkTimeout at the hard limit when the requested wait outlasts it, and never consumes", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, counts } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18 });
    await clock.advance(19_999);
    expect(outcome.state).toBe("pending");
    await clock.advance(1);
    expect(outcome.state).toBe("rejected");
    expect(outcome.at).toBe(20_000);
    expect(outcome.error).toBeInstanceOf(PageWorkTimeout);
    expect((outcome.error as Error).message).toBe("page work timed out after 20000ms");
    expectClosedWithoutConsuming(counts);
  });

  it("fails at the hard limit when navigation never commits, and closes the context", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, counts } = capture(clock, {});
    await clock.advance(20_000);
    expect(outcome.at).toBe(20_000);
    expect(outcome.error).toBeInstanceOf(PageWorkTimeout);
    expect((outcome.error as Error).message).toBe("page work timed out after 20000ms");
    expectClosedWithoutConsuming(counts);
  });

  it("throws the caller's own abort reason, not a timeout, when the caller cancels at 5 s", async () => {
    const clock = new FakeCaptureClock();
    const cancel = cancelAt(clock, 5_000);
    const { outcome, counts } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18, signal: cancel.signal });
    await clock.advance(5_000);
    expect(outcome.at).toBe(5_000);
    expect(outcome.error).toBe(cancel.reason);
    expectClosedWithoutConsuming(counts);
  });
});
