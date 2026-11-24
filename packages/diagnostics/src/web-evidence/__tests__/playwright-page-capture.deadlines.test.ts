import assert from "node:assert/strict";
import { test } from "vitest";

import type { CaptureHttpClient as HttpClientPort } from "../playwright-page-capture.js";
import { createPlaywrightPageCapture } from "../playwright-page-capture.js";
import { captureDeps, EgressRefusedError, PageCaptureError } from "./page-capture-test-deps.js";
import { captureFixture, captureRequest, watch, type CaptureFixture, type StepTimes } from "./capture-deadlines-fixture.js";

/**
 * @file The capture budget grows with the request (base 20 s, +10 s for a full page, +the requested wait,
 * never above 45 s), and the three deadline owners read ONE clock: the work deadline `T − 4 s` (ordinary
 * work ends; a page that has already loaded is shot as it is), the hard stop `T` inside the render, and
 * the adapter's outer race at `T`. Everything runs on one virtual clock; no browser, no module mocks.
 */

const httpClient: HttpClientPort = {
  async send() { throw new EgressRefusedError({ message: "private" }, { callerSafeMessage: "refused" }); },
};

function capturing({ times }: { times?: StepTimes } = {}): CaptureFixture & { capture: ReturnType<typeof createPlaywrightPageCapture> } {
  const fixture = captureFixture({ ...(times ? { times } : {}) });
  const capture = createPlaywrightPageCapture(captureDeps({ httpClient }), { loadLauncher: async () => fixture.launcher, clock: fixture.clock });
  return { ...fixture, capture };
}

test("a page that loaded at 3 s but is still settling at the work deadline is shot as it is, with the real number in the note", async t => {
  // settleMs 5000 → T = 20 s + 5 s = 25 s, work deadline 21 s.
  const fixture = capturing({ times: { goto: 3_000, wait: 60_000 } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 })));
  await fixture.clock.advance(20_999);
  assert.equal(run.outcome(), undefined, "still working one millisecond before the work deadline");
  assert.deepEqual(fixture.screenshots, []);
  await fixture.clock.advance(1);
  const outcome = run.outcome();
  assert.ok(outcome && "image" in outcome, "an image, not a timeout");
  assert.equal(outcome.image.png.toString(), "frame-0");
  assert.equal(outcome.image.note, "page loaded but did not settle within 21 s; captured the current frame (content may still be loading).");
  assert.deepEqual(fixture.screenshots, [{ at: 21_000, timeout: 4_000, animations: "allow" }], "one current-frame shot with only what is left of the budget");
});

test("one clock, three owners: the render's hard stop and the outer race both sit at T, the fallback starts at T − 4 s, and a fallback still running at T ends in one timeout", async t => {
  const fixture = capturing({ times: { wait: 60_000, screenshots: ["never"] } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 })));
  await fixture.clock.advance(21_000);
  assert.deepEqual(fixture.screenshots.map(call => call.at), [21_000], "the fallback frame starts at T − 4 s");
  assert.deepEqual(fixture.clock.deadlineSignals, [25_000], "the render's hard stop is T");
  assert.equal(fixture.clock.timeouts[0], 25_000, "the outer race is T");
  await fixture.clock.advance(3_999);
  assert.equal(run.outcome(), undefined);
  await fixture.clock.advance(1);
  const first = run.outcome();
  assert.ok(first && "failure" in first && first.failure instanceof PageCaptureError, "the fallback ends in a single typed timeout");
  assert.equal(first.failure.kind, "timeout");
  await fixture.clock.advance(30_000);
  assert.equal(run.outcome(), first, "never a second outcome");
  assert.equal(fixture.screenshots.length, 1, "never a second frame");
  assert.equal(fixture.events.filter(event => event === "browser-close").length, 1);
  assert.ok(fixture.events.includes("context-close"), "the fallback timeout closes the context");
});

test("a page that hangs the renderer (the screenshot never returns) fails at the computed T, not at 20 s and not never", async t => {
  const fixture = capturing({ times: { screenshots: ["never"] } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 })));
  await fixture.clock.advance(24_999);
  assert.equal(run.outcome(), undefined, "20 s was the old limit; this request may take 25 s");
  await fixture.clock.advance(1);
  const outcome = run.outcome();
  assert.ok(outcome && "failure" in outcome && outcome.failure instanceof PageCaptureError, "the renderer reaches a typed deadline failure");
  assert.equal(outcome.failure.kind, "timeout");
  assert.ok(fixture.events.includes("browser-close"), "the renderer deadline closes the browser");
});

test("the budget grows with the request and never passes the 45 s cap", async t => {
  const cases: Array<[Partial<Parameters<typeof captureRequest>[0]>, number]> = [
    [{ settleMs: 0 }, 20_000],
    [{ settleMs: 5_000 }, 25_000],
    [{ settleMs: 0, fullPage: true }, 30_000],
    [{ settleMs: 5_000, fullPage: true }, 35_000],
    [{ settleMs: 0, waitFor: 60 }, 45_000],
  ];
  for (const [overrides, total] of cases) {
    const fixture = capturing({ times: { wait: 0, screenshots: ["never"] } });
    t.onTestFinished(() => fixture.capture.close());
    const run = watch(fixture.capture.capture(captureRequest(overrides)));
    await fixture.clock.advance(total - 1);
    assert.equal(run.outcome(), undefined, `${JSON.stringify(overrides)} is still within ${total} ms`);
    await fixture.clock.advance(1);
    assert.ok(run.outcome(), `${JSON.stringify(overrides)} has ended by ${total} ms`);
    assert.deepEqual(fixture.clock.deadlineSignals, [total]);
  }
});

test("a full-page scroll still running at the work deadline is cut there and the page is shot as it is (was: a 'timeout' with nothing)", async t => {
  // fullPage, settleMs 0 → T = 30 s, work deadline 26 s.
  const fixture = capturing({ times: { scroll: "never" } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ fullPage: true, settleMs: 0 })));
  await fixture.clock.advance(25_999);
  assert.equal(run.outcome(), undefined);
  assert.deepEqual(fixture.screenshots, []);
  await fixture.clock.advance(1);
  const outcome = run.outcome();
  assert.ok(outcome && "image" in outcome, "an image, not a timeout");
  assert.equal(outcome.image.note, "page loaded but did not settle within 26 s; captured the current frame (content may still be loading).");
  assert.deepEqual(fixture.screenshots, [{ at: 26_000, timeout: 4_000, animations: "allow" }]);
});

test("a full-page scroll that ends before the work deadline keeps the stable-frame attempt, with the reserve taken from what is left", async t => {
  const fixture = capturing({ times: { scroll: 25_000 } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ fullPage: true, settleMs: 0 })));
  await fixture.clock.advance(25_000);
  const outcome = run.outcome();
  assert.ok(outcome === undefined || "image" in outcome, "the pre-deadline state permits a pending capture or an image");
  await fixture.clock.advance(1);
  const done = run.outcome();
  assert.ok(done && "image" in done, "the completed scroll produces a stable-frame image");
  assert.equal(done.image.note, undefined, "it settled in time: no note");
  assert.deepEqual(fixture.screenshots, [{ at: 25_000, timeout: 1_000, animations: "disabled" }], "30 s − 25 s left, minus the 4 s reserve");
});

test("a navigation that never commits fails at the work deadline and says so: the site did not answer, with that number", async t => {
  const fixture = capturing({ times: { goto: "never" } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 })));
  await fixture.clock.advance(20_999);
  assert.equal(run.outcome(), undefined, "T is 25 s, the work deadline 21 s");
  await fixture.clock.advance(1);
  const outcome = run.outcome();
  assert.ok(outcome && "failure" in outcome && outcome.failure instanceof PageCaptureError, "navigation fails at its work deadline");
  assert.equal(outcome.failure.kind, "timeout");
  assert.equal(outcome.failure.limitMs, 21_000, "the work deadline");
  assert.equal(outcome.failure.loaded, false);
});

test("a page that loaded but hung the renderer fails at T and says so: it did not finish, with T", async t => {
  const fixture = capturing({ times: { screenshots: ["never"] } });
  t.onTestFinished(() => fixture.capture.close());
  const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 })));
  await fixture.clock.advance(25_000);
  const outcome = run.outcome();
  assert.ok(outcome && "failure" in outcome && outcome.failure instanceof PageCaptureError, "the hung renderer fails at the total deadline");
  assert.equal(outcome.failure.limitMs, 25_000);
  assert.equal(outcome.failure.loaded, true);
});

test("a caller cancel at any time ends the capture with the cancel's own error, starts no frame, and never a fallback", async t => {
  // settleMs 5000 → T = 25 s, work deadline 21 s.
  const loading: StepTimes = { goto: 3_000, wait: 60_000 };
  const cases: Array<{ label: string; times: StepTimes; cancelAt: number; framesBefore: number }> = [
    { label: "during the wait", times: loading, cancelAt: 10_000, framesBefore: 0 },
    { label: "just before the work deadline", times: loading, cancelAt: 20_999, framesBefore: 0 },
    { label: "during the fallback frame", times: { ...loading, screenshots: ["never"] }, cancelAt: 22_000, framesBefore: 1 },
    { label: "during the stable-frame attempt", times: { wait: 0, screenshots: ["never"] }, cancelAt: 1_000, framesBefore: 1 },
  ];
  for (const { label, times, cancelAt, framesBefore } of cases) {
    const fixture = capturing({ times });
    t.onTestFinished(() => fixture.capture.close());
    const reason = new Error(`cancelled ${label}`);
    const controller = new AbortController();
    const run = watch(fixture.capture.capture(captureRequest({ settleMs: 5_000 }), { signal: controller.signal }));
    await fixture.clock.advance(cancelAt);
    assert.equal(fixture.screenshots.length, framesBefore, `${label}: frames before the cancel`);
    controller.abort(reason);
    await fixture.clock.advance(30_000);
    const outcome = run.outcome();
    assert.ok(outcome && "failure" in outcome, `${label}: no image`);
    assert.equal(outcome.failure, reason, `${label}: the cancel's own error`);
    assert.equal(fixture.screenshots.length, framesBefore, `${label}: no frame after the cancel`);
  }
});
