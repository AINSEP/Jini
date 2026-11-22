/**
 * @file Coverage for `window-bounds-store.ts`: the JSON round trip, and the on-screen decision that
 * keeps a remembered position from opening off a display that no longer exists.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  boundsOnScreen,
  readWindowBounds,
  resolveWindowBounds,
  windowBoundsFilePath,
  writeWindowBounds,
  type WindowBounds,
} from "../window-bounds-store.js";

/** A fresh scratch `userData`-like directory per test, cleaned up after. */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tovu-window-bounds-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PRIMARY = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const SECONDARY_LEFT = { bounds: { x: -1440, y: 0, width: 1440, height: 900 } };

test("windowBoundsFilePath names window-bounds.json under the given userData dir", () => {
  assert.equal(windowBoundsFilePath({ userDataDir: "/x/userData" }), path.join("/x/userData", "window-bounds.json"));
});

test("readWindowBounds: null when the file does not exist yet", () => {
  withTempDir((dir) => {
    assert.equal(readWindowBounds({ boundsPath: windowBoundsFilePath({ userDataDir: dir }) }), null);
  });
});

test("writeWindowBounds then readWindowBounds round-trips exactly", () => {
  withTempDir((dir) => {
    const boundsPath = windowBoundsFilePath({ userDataDir: dir });
    const bounds: WindowBounds = { x: 120, y: 80, width: 1360, height: 900 };
    writeWindowBounds({ boundsPath, bounds });
    assert.deepEqual(readWindowBounds({ boundsPath }), bounds);
  });
});

test("readWindowBounds: null for malformed JSON, a non-object, or a missing/non-finite field", () => {
  withTempDir((dir) => {
    const boundsPath = windowBoundsFilePath({ userDataDir: dir });
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(boundsPath, "not json");
    assert.equal(readWindowBounds({ boundsPath }), null, "malformed JSON");

    fs.writeFileSync(boundsPath, "42");
    assert.equal(readWindowBounds({ boundsPath }), null, "a non-object");

    fs.writeFileSync(boundsPath, JSON.stringify({ x: 0, y: 0, width: 800 }));
    assert.equal(readWindowBounds({ boundsPath }), null, "missing height");

    fs.writeFileSync(boundsPath, JSON.stringify({ x: 0, y: 0, width: Infinity, height: 900 }));
    assert.equal(readWindowBounds({ boundsPath }), null, "a non-finite field");
  });
});

test("writeWindowBounds creates the userData dir if it does not exist yet", () => {
  withTempDir((dir) => {
    const nested = path.join(dir, "not-yet-created");
    const boundsPath = windowBoundsFilePath({ userDataDir: nested });
    writeWindowBounds({ boundsPath, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    assert.deepEqual(readWindowBounds({ boundsPath }), { x: 0, y: 0, width: 800, height: 600 });
  });
});

test("boundsOnScreen: true when the window is fully within one display", () => {
  assert.equal(boundsOnScreen({ bounds: { x: 100, y: 100, width: 800, height: 600 }, displays: [PRIMARY] }), true);
});

test("boundsOnScreen: true when only a corner (at least MIN_ONSCREEN_PX) still overlaps", () => {
  // Mostly off the left edge, 150px of it still on the primary display.
  assert.equal(boundsOnScreen({ bounds: { x: -1210, y: 100, width: 1360, height: 900 }, displays: [PRIMARY] }), true);
});

test("boundsOnScreen: false when the overlap is a sliver under the minimum", () => {
  assert.equal(boundsOnScreen({ bounds: { x: -1350, y: 100, width: 1360, height: 900 }, displays: [PRIMARY] }), false);
});

test("boundsOnScreen: false for a display that no longer exists (an unplugged secondary monitor)", () => {
  // Bounds recorded while a monitor to the LEFT of the primary was attached; that display is gone now.
  assert.equal(boundsOnScreen({ bounds: { x: -1200, y: 100, width: 1000, height: 700 }, displays: [PRIMARY] }), false);
});

test("boundsOnScreen: true when it overlaps ANY of several displays, not necessarily the first", () => {
  assert.equal(boundsOnScreen({ bounds: { x: -1200, y: 100, width: 1000, height: 700 }, displays: [PRIMARY, SECONDARY_LEFT] }), true);
});

test("resolveWindowBounds: the stored rectangle when it is still on-screen", () => {
  const stored: WindowBounds = { x: 200, y: 150, width: 1200, height: 800 };
  assert.deepEqual(
    resolveWindowBounds({ stored, displays: [PRIMARY], fallback: { width: 1360, height: 900 } }),
    stored,
  );
});

test("resolveWindowBounds: just the fallback size (no x/y) when nothing was stored", () => {
  assert.deepEqual(
    resolveWindowBounds({ stored: null, displays: [PRIMARY], fallback: { width: 1360, height: 900 } }),
    { width: 1360, height: 900 },
  );
});

test("resolveWindowBounds: falls back rather than trust a rectangle off every current display", () => {
  const stored: WindowBounds = { x: -5000, y: -5000, width: 1360, height: 900 };
  assert.deepEqual(
    resolveWindowBounds({ stored, displays: [PRIMARY], fallback: { width: 1360, height: 900 } }),
    { width: 1360, height: 900 },
  );
});
