/**
 * @file The last-window quit ask through fake windows and a fake native box: when it fires, what it
 * says, that Cancel keeps the window, and that no quit route ever meets it.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { LastWindowQuitDialogOptions } from "../index.js";
import { createLastWindowQuitPrompt, quitChildCounts } from "../index.js";

const labels = {
  quitOne: "Quit Workspace and stop {count} running site?",
  quitMany: "Quit Workspace and stop {count} running sites?",
  keepsOne: "{count} site this app didn’t start keeps running.",
  keepsMany: "{count} sites this app didn’t start keep running.",
  quit: "Quit",
  keepInBackground: "Keep running in background",
  cancel: "Cancel",
};

interface FakeWindow {
  emitClose(): boolean;
  emitClosed(): void;
  close(): void;
  minimize(): void;
  closeCalls: number;
  minimizes: number;
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: "closed", listener: () => void): unknown;
}

/** A window whose `emitClose` answers whether the close went through. */
function fakeWindow(): FakeWindow {
  const close: ((event: { preventDefault(): void }) => void)[] = [];
  const closed: (() => void)[] = [];
  const window: FakeWindow = {
    closeCalls: 0,
    minimizes: 0,
    on(event: "close" | "closed", listener: never) {
      if (event === "close") close.push(listener);
      else closed.push(listener);
    },
    emitClose() {
      let prevented = false;
      for (const listener of close) listener({ preventDefault: () => { prevented = true; } });
      return !prevented;
    },
    emitClosed() { for (const listener of closed) listener(); },
    // Like Electron's: asks the same `close` listeners, so a repeat ask would show up here.
    close() { window.closeCalls += 1; if (window.emitClose()) window.emitClosed(); },
    minimize() { window.minimizes += 1; },
  };
  return window;
}

/** The prompt over fake ports. `answers` holds each open box's resolver, for the test to settle. */
function harness({ children = [{}], platform = "darwin" }: { children?: { external?: boolean }[]; platform?: string } = {}) {
  const shown: { parent: FakeWindow; options: LastWindowQuitDialogOptions }[] = [];
  const answers: { resolve(answer: { response: number }): void; reject(error: Error): void }[] = [];
  const errors: unknown[] = [];
  let quits = 0;
  let kept = 0;
  const prompt = createLastWindowQuitPrompt<FakeWindow>({ ports: {
    openChildren: () => children,
    platform,
    dialogCopy: () => ({ title: "Workspace", labels }),
    showMessageBox: ({ window: parent, options }) => {
      shown.push({ parent, options });
      return new Promise((resolve, reject) => answers.push({ resolve, reject }));
    },
    quit: () => { quits += 1; },
    keepChildrenRunning: () => { kept += 1; },
    reportError: ({ error }) => errors.push(error),
  } });
  return { prompt, shown, answers, errors, quits: () => quits, kept: () => kept };
}

/** The box's answers, in button order. */
const [QUIT, KEEP_RUNNING, CANCEL] = [0, 1, 2];

/** Lets the prompt's promise chain run after a fake box settles. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

test("closing the last window with a running site holds the close and asks on that window", () => {
  const h = harness({ children: [{}, {}] });
  const window = fakeWindow();
  h.prompt.watch({ window });
  assert.equal(window.emitClose(), false);
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0]!.parent, window, "a sheet on macOS, parent-modal on Windows");
  assert.equal(h.shown[0]!.options.message, "Quit Workspace and stop 2 running sites?");
  assert.equal(h.quits(), 0, "nothing quits before the answer");
});

test("Quit quits once; Cancel keeps the window and a later close asks again", async () => {
  const h = harness();
  const window = fakeWindow();
  h.prompt.watch({ window });

  window.emitClose();
  h.answers[0]!.resolve({ response: CANCEL });
  await settled();
  assert.equal(h.quits(), 0, "Cancel does not quit");
  assert.equal(h.kept(), 0, "Cancel leaves idle sleep alone");

  assert.equal(window.emitClose(), false, "the window stays open and the next close asks again");
  assert.equal(h.shown.length, 2);
  h.answers[1]!.resolve({ response: QUIT });
  await settled();
  assert.equal(h.quits(), 1);
  assert.equal(window.closeCalls + window.minimizes, 0, "the ordinary quit closes the windows, not this box");
});

test("macOS: Keep running closes the window without asking again, and the app stays in the Dock", async () => {
  const h = harness({ platform: "darwin" });
  const window = fakeWindow();
  h.prompt.watch({ window });
  window.emitClose();
  h.answers[0]!.resolve({ response: KEEP_RUNNING });
  await settled();
  assert.equal(window.closeCalls, 1);
  assert.equal(window.minimizes, 0);
  assert.equal(h.shown.length, 1, "the close it runs is not asked about again");
  assert.equal(h.quits(), 0, "the sites keep running, so nothing quits");
  assert.equal(h.kept(), 1, "idle sleep must not stop them later");

  const reopened = fakeWindow();
  h.prompt.watch({ window: reopened });
  assert.equal(reopened.emitClose(), false, "a window reopened from the Dock asks again");
  assert.equal(h.shown.length, 2);
});

test("macOS: a page that vetoes the Keep running close does not lose the next ask", async () => {
  const h = harness({ platform: "darwin" });
  const window = fakeWindow();
  window.close = () => { window.closeCalls += 1; window.emitClose(); };
  h.prompt.watch({ window });
  window.emitClose();
  h.answers[0]!.resolve({ response: KEEP_RUNNING });
  await settled();
  assert.equal(window.closeCalls, 1);
  assert.equal(window.emitClose(), false, "the window is still open, so closing it asks");
  assert.equal(h.shown.length, 2);
});

for (const platform of ["win32", "linux"]) {
  test(`${platform}: Keep running minimizes, because a closed last window would end the app`, async () => {
    const h = harness({ platform });
    const window = fakeWindow();
    h.prompt.watch({ window });
    window.emitClose();
    h.answers[0]!.resolve({ response: KEEP_RUNNING });
    await settled();
    assert.equal(window.minimizes, 1);
    assert.equal(window.closeCalls, 0, "window-all-closed would quit and stop every site");
    assert.equal(h.quits(), 0);
    assert.equal(h.kept(), 1);

    assert.equal(window.emitClose(), false, "the way out: closing it again asks again");
    h.answers[1]!.resolve({ response: QUIT });
    await settled();
    assert.equal(h.quits(), 1, "and Quit really quits");
  });

  test(`${platform}: Cancel neither minimizes nor closes`, async () => {
    const h = harness({ platform });
    const window = fakeWindow();
    h.prompt.watch({ window });
    window.emitClose();
    h.answers[0]!.resolve({ response: CANCEL });
    await settled();
    assert.equal(window.minimizes + window.closeCalls + h.quits() + h.kept(), 0);
  });
}

test("with no running site the close goes through untouched, as it did before this ask", () => {
  const h = harness({ children: [] });
  const window = fakeWindow();
  h.prompt.watch({ window });
  assert.equal(window.emitClose(), true);
  assert.equal(h.shown.length, 0);
});

test("a site this app only attached to is not counted, and the box says it stays running", () => {
  assert.deepEqual(quitChildCounts({ children: [{}, { external: true }, { external: false }] }), { stops: 2, keeps: 1 });

  const onlyAttached = harness({ children: [{ external: true }] });
  const alone = fakeWindow();
  onlyAttached.prompt.watch({ window: alone });
  assert.equal(alone.emitClose(), true, "quitting would stop nothing, so there is nothing to ask");
  assert.equal(onlyAttached.shown.length, 0);

  const mixed = harness({ children: [{}, { external: true }] });
  const window = fakeWindow();
  mixed.prompt.watch({ window });
  window.emitClose();
  assert.equal(mixed.shown[0]!.options.message, "Quit Workspace and stop 1 running site?");
  assert.equal(mixed.shown[0]!.options.detail, "1 site this app didn’t start keeps running.");
});

test("the last-window prompt distinguishes plural counts of owned and attached sites", () => {
  const h = harness({ children: [{}, { external: false }, { external: true }, { external: true }, { external: true }] });
  const window = fakeWindow();
  h.prompt.watch({ window });
  assert.equal(window.emitClose(), false);
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0]!.options.message, "Quit Workspace and stop 2 running sites?");
  assert.equal(h.shown[0]!.options.detail, "3 sites this app didn’t start keep running.");
});

test("closing a window that is not the last never asks; the one left then counts as last", () => {
  const h = harness();
  const first = fakeWindow();
  const second = fakeWindow();
  h.prompt.watch({ window: first });
  h.prompt.watch({ window: second });

  assert.equal(first.emitClose(), true);
  assert.equal(h.shown.length, 0);
  // `close` alone is not gone: a page's `beforeunload` can still veto it. Only `closed` is.
  assert.equal(second.emitClose(), true, "the first window has not reported `closed` yet");
  first.emitClosed();
  assert.equal(second.emitClose(), false);
  assert.equal(h.shown.length, 1);
});

test("a second close while the box is open is held without a second box", () => {
  const h = harness();
  const window = fakeWindow();
  h.prompt.watch({ window });
  window.emitClose();
  assert.equal(window.emitClose(), false);
  assert.equal(h.shown.length, 1);
});

test("once any quit has started no close asks, whatever is still open", () => {
  const h = harness();
  const window = fakeWindow();
  h.prompt.watch({ window });
  h.prompt.onQuitStarted();
  assert.equal(window.emitClose(), true, "Cmd+Q, a signal, Restart to update and the drain's own final quit");
  assert.equal(h.shown.length, 0);
});

test("a quit that starts while the box is open dismisses it and is not held by it", () => {
  const h = harness();
  const window = fakeWindow();
  h.prompt.watch({ window });
  window.emitClose();
  const signal = h.shown[0]!.options.signal!;
  assert.equal(signal.aborted, false);
  h.prompt.onQuitStarted();
  assert.equal(signal.aborted, true);
  assert.equal(window.emitClose(), true);
  h.prompt.onQuitStarted();
});

test("a box that fails is logged, leaves the window open, and does not wedge the next close", async () => {
  const h = harness();
  const window = fakeWindow();
  h.prompt.watch({ window });
  window.emitClose();
  h.answers[0]!.reject(new Error("no box"));
  await settled();
  assert.deepEqual(h.errors, [new Error("no box")]);
  assert.equal(h.quits(), 0);
  assert.equal(window.emitClose(), false);
  assert.equal(h.shown.length, 2);
});

test("openCount counts app windows only, so a hidden capture window cannot keep a Dock click from reopening", () => {
  const h = harness();
  const window = fakeWindow();
  assert.equal(h.prompt.openCount(), 0);
  h.prompt.watch({ window });
  assert.equal(h.prompt.openCount(), 1);
  window.emitClosed();
  assert.equal(h.prompt.openCount(), 0);
});
