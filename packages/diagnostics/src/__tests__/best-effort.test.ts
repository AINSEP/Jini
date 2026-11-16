import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ignoreBestEffortFailure } from "../best-effort.js";

test("logs what failed and the cause's message at debug, and does not throw", () => {
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  try {
    const cause = Object.assign(new Error("Target closed"), { code: "ECONNRESET" });
    assert.equal(ignoreBestEffortFailure({ operation: "close the page browser" })(cause), undefined);
    assert.deepEqual(debug.mock.calls, [["[diagnostics] best-effort step failed and was ignored: close the page browser: Error(ECONNRESET): Target closed"]]);
  } finally { debug.mockRestore(); }
});

test("redacts credentials in the cause and survives a non-Error rejection", () => {
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  try {
    const handler = ignoreBestEffortFailure({ operation: "abort a route" });
    handler(new Error("fetch failed token=" + "ghp_" + "a".repeat(36)));
    handler("plain string");
    const lines = debug.mock.calls.map(call => String(call[0]));
    assert.equal(lines[0]?.includes("ghp_"), false);
    assert.equal(lines[0]?.startsWith("[diagnostics] best-effort step failed and was ignored: abort a route: Error: fetch failed token="), true);
    assert.equal(lines[1], "[diagnostics] best-effort step failed and was ignored: abort a route: string");
  } finally { debug.mockRestore(); }
});
