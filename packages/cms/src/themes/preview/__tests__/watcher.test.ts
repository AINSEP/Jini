import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createThemeWatcher, type ThemeWatchPort } from "../watcher.node.js";

const stops: (() => Promise<void>)[] = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); vi.useRealTimers(); });

function fixture() {
  let callbacks!: Parameters<ThemeWatchPort["open"]>[0];
  let closes = 0;
  const errors: unknown[] = [];
  const refresh = vi.fn((_required: { themesDir: string }) => {});
  const startThemeWatcher = createThemeWatcher({ onError: ({ error }) => { errors.push(error); } });
  const watchPort: ThemeWatchPort = { open(input) {
    callbacks = input;
    return { close: () => { closes += 1; } };
  } };
  const start = () => {
    const watcher = startThemeWatcher({ themesDir: "/site/themes", refresh }, { watchPort });
    stops.push(watcher.stop);
    return watcher;
  };
  const watcher = start();
  return { refresh, errors, startThemeWatcher, watchPort, watcher, start, closes: () => closes,
    callbacks: () => callbacks, change: (filename: string | null) => callbacks.onChange({ filename }) };
}

test("a burst resets the settle timer and refreshes synchronously once at 400ms", () => {
  const f = fixture();
  f.change("static/plain/theme.json");
  vi.advanceTimersByTime(300);
  f.change("static/plain/tokens.json");
  vi.advanceTimersByTime(399);
  assert.equal(f.refresh.mock.calls.length, 0);
  vi.advanceTimersByTime(1);
  assert.deepEqual(f.refresh.mock.calls, [[{ themesDir: "/site/themes" }]]);
  vi.advanceTimersByTime(2000);
  assert.equal(f.refresh.mock.calls.length, 1);
});

test("ignored nested paths never trigger or postpone refresh", () => {
  const f = fixture();
  const ignored = [".preview-refresh.json", ".git/index", "static/plain/.DS_Store", "static/plain/node_modules/pkg/index.js",
    "static\\plain\\node_modules\\pkg\\index.js", "static/plain/.style.css.swp", "static/plain/style.css.swo",
    "static/plain/style.css.swn", "static/plain/style.css~", "static/plain/#style.css#", "static/plain/style.tmp",
    "static/plain/style.temp", "static/plain/style.bak", "static/plain/style.css___jb_tmp___", "static/plain/style.css___jb_old___"];
  for (const filename of ignored) f.change(filename);
  vi.advanceTimersByTime(400);
  assert.equal(f.refresh.mock.calls.length, 0);
  f.change("static/plain/styles.css");
  vi.advanceTimersByTime(300);
  for (const filename of ignored) f.change(filename);
  vi.advanceTimersByTime(100);
  assert.equal(f.refresh.mock.calls.length, 1);
});

test("null filenames still refresh", () => {
  const f = fixture();
  f.change(null);
  vi.advanceTimersByTime(400);
  assert.equal(f.refresh.mock.calls.length, 1);
});

test("stop cancels pending work, ignores late events and closes once", async () => {
  const f = fixture();
  f.change("static/plain/styles.css");
  await f.watcher.stop();
  await f.watcher.stop();
  f.change("static/plain/styles.css");
  vi.advanceTimersByTime(1000);
  assert.equal(f.closes(), 1);
  assert.equal(f.refresh.mock.calls.length, 0);
});

test("replacement stops the prior watcher and stale handles cannot stop its successor", async () => {
  const f = fixture(), oldChange = f.callbacks().onChange;
  f.change("static/plain/styles.css");
  const restarted = f.start();
  assert.equal(f.closes(), 1);
  await f.watcher.stop();
  assert.equal(f.closes(), 1);
  let nextClosed = 0;
  const switched = f.startThemeWatcher({ themesDir: "/other-site/themes", refresh: f.refresh }, {
    watchPort: { open: () => ({ close: () => { nextClosed += 1; } }) },
  });
  stops.push(switched.stop);
  assert.equal(f.closes(), 2);
  await restarted.stop();
  oldChange({ filename: "static/plain/styles.css" });
  vi.advanceTimersByTime(1000);
  assert.equal(f.refresh.mock.calls.length, 0);
  assert.equal(nextClosed, 0);
  await switched.stop();
  assert.equal(nextClosed, 1);
  let nestedCloses = 0;
  const reentrant = f.startThemeWatcher({ themesDir: "/reentrant/themes", refresh: f.refresh }, {
    watchPort: { open: () => ({ close: () => {
      const nested = f.startThemeWatcher({ themesDir: "/nested/themes", refresh: f.refresh }, {
        watchPort: { open: () => ({ close: () => { nestedCloses += 1; } }) },
      });
      stops.push(nested.stop);
    } }) },
  });
  stops.push(reentrant.stop);
  await reentrant.stop();
  f.start();
  assert.equal(nestedCloses, 1);
});

test("watch errors cancel pending work, close the handle and report", () => {
  const f = fixture(), error = new Error("watch failed");
  f.change("static/plain/styles.css");
  f.callbacks().onError({ error });
  vi.advanceTimersByTime(400);
  assert.deepEqual(f.errors, [error]);
  assert.equal(f.closes(), 1);
  assert.equal(f.refresh.mock.calls.length, 0);
});

test("opening failures are reported and a subsequent start recovers", async () => {
  const f = fixture(), error = new Error("watch unavailable"), overrides: unknown[] = [];
  const failed = f.startThemeWatcher({ themesDir: "/site/themes", refresh: f.refresh }, {
    watchPort: { open() { throw error; } }, onError: ({ error }) => { overrides.push(error); },
  });
  stops.push(failed.stop);
  assert.deepEqual(overrides, [error]);
  assert.deepEqual(f.errors, []);
  assert.equal(f.closes(), 1);
  f.start();
  await failed.stop();
  f.change("static/plain/styles.css");
  vi.advanceTimersByTime(400);
  assert.equal(f.refresh.mock.calls.length, 1);
});

test("failed refresh reports after attempting work and retries on the next edit", () => {
  const f = fixture(), error = new Error("refresh failed");
  f.refresh.mockImplementationOnce(() => { assert.deepEqual(f.errors, []); throw error; });
  f.change("static/plain/styles.css");
  vi.advanceTimersByTime(400);
  assert.deepEqual(f.errors, [error]);
  assert.equal(f.closes(), 0);
  f.change("static/plain/styles.css");
  vi.advanceTimersByTime(400);
  assert.equal(f.refresh.mock.calls.length, 2);
  assert.deepEqual(f.errors, [error]);
});

test("two factories keep independent active watcher handles", async () => {
  const first = fixture(), second = fixture();
  assert.equal(first.closes(), 0);
  assert.equal(second.closes(), 0);
  first.start();
  assert.equal(first.closes(), 1);
  assert.equal(second.closes(), 0);
  await first.watcher.stop();
  first.change(null);
  second.change(null);
  vi.advanceTimersByTime(400);
  assert.equal(first.refresh.mock.calls.length, 1);
  assert.equal(second.refresh.mock.calls.length, 1);
});
