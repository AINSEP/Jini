/** @file Tests for `live-verify-checks.ts` — the PASS/FAIL ledger the live verifiers print and exit on. */
import { test } from "vitest";
import assert from "node:assert/strict";

import { createCheckLog } from "../live-verify-checks.js";

test("a run whose every check passes prints PASS lines and VERIFY_OK, and exits 0", () => {
  const lines: string[] = [];
  const log = createCheckLog({ log: ({ line }, _options = {}) => lines.push(line) });
  log.check({ name: "BAR_OPENS", ok: true, detail: "find bar present" });
  log.check({ name: "INPUT_KEEPS_FOCUS", ok: true, detail: "activeElement = findbar__input" });
  assert.equal(log.report(), 0);
  assert.deepEqual(lines, ["PASS:: BAR_OPENS — find bar present", "PASS:: INPUT_KEEPS_FOCUS — activeElement = findbar__input", "\nVERIFY_OK:: every check passed"]);
});

test("any failed check is printed as it happens and listed again in the verdict, which exits 1", () => {
  const lines: string[] = [];
  const log = createCheckLog({ log: ({ line }, _options = {}) => lines.push(line) });
  log.check({ name: "A", ok: false, detail: "first reason" });
  log.check({ name: "B", ok: true, detail: "fine" });
  log.check({ name: "C", ok: false, detail: "second reason" });
  assert.equal(log.report(), 1);
  assert.deepEqual(lines, ["FAIL:: A — first reason", "PASS:: B — fine", "FAIL:: C — second reason",
    "\nVERIFY_FAILED:: 2 check(s)\n- A: first reason\n- C: second reason"]);
});

test("each ledger is independent", () => {
  const first = createCheckLog({ log: () => {} });
  first.check({ name: "X", ok: false, detail: "bad" });
  assert.equal(createCheckLog({ log: () => {} }).report(), 0);
  assert.equal(first.report(), 1);
});
