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
  const counts = { contextOpened: 0, contextClosed: 0, consumed: 0 };
  const page: RenderPage = {
    goto: async () => { if (commitsAtMs === undefined) return never(); await sleep(commitsAtMs - clock.now()); return { status: () => 200, url: () => URL_UNDER_TEST }; },
    waitForTimeout: sleep,
    ...(loadStalls ? { waitForLoadState: () => never() } : {}),
    evaluate: async () => undefined, title: async () => "Fixture", url: () => URL_UNDER_TEST,
  };
  const browser: RenderBrowser = {
    newContext: async () => { counts.contextOpened += 1; return { newPage: async () => page, route: async () => {}, close: async () => { counts.contextClosed += 1; } }; },
    close: async () => {},
  };
  return { browser, counts };
}

interface Outcome { state: "pending" | "resolved" | "rejected"; at?: number; value?: unknown; error?: unknown }

/** Start a capture and record when and how it settled, in clock time. */
function capture(clock: FakeCaptureClock, scenario: Scenario, options: Parameters<typeof renderPage>[1] = {}, consumer: (session: RenderSession) => Promise<string> = async () => "captured") {
  const { browser, counts } = fixture(clock, scenario);
  const sessions: Array<{ session: RenderSession; at: number; remainingMs: number }> = [];
  const outcome: Outcome = { state: "pending" };
  void renderPage({ browser, url: URL_UNDER_TEST, consume: session => {
    counts.consumed += 1; sessions.push({ session, at: clock.now(), remainingMs: session.budget.remainingMs() });
    return consumer(session);
  } },
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

const SOFT = { softDeadlineMs: 16_000, onSoftDeadline: "consume-current" } as const;

describe("renderPage with a soft deadline of 16 s inside a 20 s hard limit", () => {
  it("runs the fallback once at 16 s when the requested wait is still running, with 4 s left, and returns its result", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, counts, sessions } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18, ...SOFT });
    await clock.advance(15_999);
    expect(counts.consumed).toBe(0);
    await clock.advance(1);
    expect(sessions.map(({ at, remainingMs }) => [at, remainingMs])).toEqual([[16_000, 4_000]]);
    expect(sessions[0]!.session.phaseTimedOut).toBe("wait");
    expect(outcome).toMatchObject({ state: "resolved", value: "captured", at: 16_000 });
    expect(counts.consumed).toBe(1);
    expect(counts.contextClosed).toBeGreaterThanOrEqual(1);
  });

  it("names the load wait when that is where the work deadline hit", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, sessions } = capture(clock, { commitsAtMs: 3_000, loadStalls: true }, { waitFor: 0, loadWaitMs: 30_000, ...SOFT });
    await clock.advance(16_000);
    expect(sessions.map(({ at }) => at)).toEqual([16_000]);
    expect(sessions[0]!.session.phaseTimedOut).toBe("load");
    expect(outcome.state).toBe("resolved");
  });

  it("hands the consumer the page that committed, at the same final URL a normal capture would report", async () => {
    const clock = new FakeCaptureClock();
    const { sessions } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18, ...SOFT });
    await clock.advance(16_000);
    expect(sessions[0]!.session.finalUrl).toBe(URL_UNDER_TEST);
    expect(sessions[0]!.session.response?.status()).toBe(200);
  });

  it("does not use the fallback when the work finishes in time: the consumer runs early and no phase is reported", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, sessions } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 5, ...SOFT });
    await clock.advance(8_000);
    expect(sessions.map(({ at, remainingMs }) => [at, remainingMs])).toEqual([[8_000, 12_000]]);
    expect(sessions[0]!.session.phaseTimedOut).toBeUndefined();
    expect(outcome).toMatchObject({ state: "resolved", value: "captured" });
  });

  it("fails at 16 s with PageWorkTimeout, and never consumes, when navigation has not committed", async () => {
    const clock = new FakeCaptureClock();
    const { outcome, counts } = capture(clock, {}, { ...SOFT });
    await clock.advance(15_999);
    expect(outcome.state).toBe("pending");
    await clock.advance(1);
    expect(outcome.at).toBe(16_000);
    expect(outcome.error).toBeInstanceOf(PageWorkTimeout);
    expect((outcome.error as Error).message).toBe("page work timed out after 16000ms");
    expectClosedWithoutConsuming(counts);
  });

  it("stops a fallback that is still running at 20 s: one PageWorkTimeout, the context closed, the late settlement swallowed, no second consume", async () => {
    const clock = new FakeCaptureClock();
    let settleLate: (value: string) => void = () => {};
    const { outcome, counts } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18, ...SOFT },
      () => new Promise<string>(resolve => { settleLate = resolve; }));
    await clock.advance(16_000);
    expect(counts.consumed).toBe(1);
    expect(outcome.state).toBe("pending");
    await clock.advance(3_999);
    expect(outcome.state).toBe("pending");
    await clock.advance(1);
    expect(outcome.at).toBe(20_000);
    expect(outcome.error).toBeInstanceOf(PageWorkTimeout);
    expect((outcome.error as Error).message).toBe("page work timed out after 20000ms");
    expect(counts.contextClosed).toBeGreaterThanOrEqual(1);
    const settled = { ...outcome };
    settleLate("too late");
    await clock.advance(5_000);
    expect(outcome).toEqual(settled);
    expect(counts.consumed).toBe(1);
  });

  it.each([
    ["before the soft deadline, 15.9 s", 15_900, 0],
    ["on the soft deadline, 16 s (the cancel is scheduled first)", 16_000, 0],
    ["during the fallback, 17 s", 17_000, 1],
  ])("throws the caller's reason for a cancel %s, and a cancel never starts the fallback", async (_name, cancelMs, consumedByDeadline) => {
    const clock = new FakeCaptureClock();
    const cancel = cancelAt(clock, cancelMs);
    const { outcome, counts } = capture(clock, { commitsAtMs: 3_000 }, { waitFor: 18, signal: cancel.signal, ...SOFT },
      () => never());
    await clock.advance(cancelMs);
    expect(outcome.at).toBe(cancelMs);
    expect(outcome.error).toBe(cancel.reason);
    expect(counts.consumed).toBe(consumedByDeadline);
    expect(counts.contextClosed).toBeGreaterThanOrEqual(1);
    await clock.advance(10_000);
    expect(counts.consumed).toBe(consumedByDeadline);
    expect(outcome.error).toBe(cancel.reason);
  });

  it.each([
    ["equal to timeoutMs", 20_000],
    ["above timeoutMs", 25_000],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a softDeadlineMs %s with a RangeError before opening anything", async (_name, softDeadlineMs) => {
    const clock = new FakeCaptureClock();
    const { outcome, counts } = capture(clock, { commitsAtMs: 3_000 }, { softDeadlineMs, onSoftDeadline: "consume-current" });
    await clock.advance(0);
    expect(outcome.error).toBeInstanceOf(RangeError);
    expect((outcome.error as Error).message).toBe(`softDeadlineMs must be above 0 and below timeoutMs (20000), got ${softDeadlineMs}`);
    expect(counts.contextOpened).toBe(0);
  });
});
