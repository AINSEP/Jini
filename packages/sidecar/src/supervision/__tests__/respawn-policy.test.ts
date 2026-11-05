import assert from "node:assert/strict";
import { test } from "vitest";

import { createRespawnPolicy } from "../respawn-policy.js";

// Characterization cases generalized from the original daemon policy tests.

test("first failure retries at the fast end of the backoff ladder", () => {
  const policy = createRespawnPolicy({ now: () => 0 });
  const decision = policy.recordFailure({ isPortConflict: false });
  assert.deepEqual(decision, { action: "retry", delayMs: 1_000, attempt: 1 });
  assert.equal(policy.isTripped(), false);
});

test("backoff escalates 1s,2s,4s,8s,16s,30s and then holds at the 30s cap", () => {
  const policy = createRespawnPolicy({ now: () => 0 }, { crashLoopMaxFailures: 8 });
  const delays: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const decision = policy.recordFailure({ isPortConflict: false });
    assert.equal(decision.action, "retry", `attempt ${i + 1} should still be retrying`);
    delays.push(decision.action === "retry" ? decision.delayMs : -1);
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
});

test("the generic crash-loop cap trips on the 5th failure inside the window, with a distinct reason", () => {
  const policy = createRespawnPolicy({ now: () => 0 });
  for (let i = 0; i < 4; i += 1) {
    const decision = policy.recordFailure({ isPortConflict: false });
    assert.equal(decision.action, "retry", `attempt ${i + 1} should still be retrying`);
  }
  const fifth = policy.recordFailure({ isPortConflict: false });
  assert.deepEqual(fifth, { action: "give-up", kind: "crash-loop", attempts: 5, windowMs: 60_000 });
  assert.equal(policy.isTripped(), true);
});

test("failures that fall outside the rolling window stop counting toward the cap", () => {
  let clock = 0;
  const policy = createRespawnPolicy({ now: () => clock });

  for (let i = 0; i < 4; i += 1) {
    const decision = policy.recordFailure({ isPortConflict: false });
    assert.equal(decision.action, "retry");
  }

  // Jump past the 60s window entirely — a healthy daemon that ran fine in between, then crashed
  // once more, must not inherit the old crash burst's count.
  clock += 61_000;
  const decision = policy.recordFailure({ isPortConflict: false });
  assert.deepEqual(decision, { action: "retry", delayMs: 1_000, attempt: 1 });
  assert.equal(policy.isTripped(), false);
});

test("PORT_IN_USE trips its own tighter, consecutive-only cap before the generic cap would fire", () => {
  const policy = createRespawnPolicy({ now: () => 0 });

  const first = policy.recordFailure({ isPortConflict: true });
  const second = policy.recordFailure({ isPortConflict: true });
  assert.equal(first.action, "retry");
  assert.equal(second.action, "retry");

  const third = policy.recordFailure({ isPortConflict: true });
  assert.deepEqual(third, { action: "give-up", kind: "port-conflict", attempts: 3 });
  assert.equal(policy.isTripped(), true);
});

test("a non-port failure resets the consecutive port-conflict counter instead of it accumulating across unrelated failures", () => {
  // Generic cap raised well above 5 calls so this test isolates the port-specific counter — the
  // default crashLoopMaxFailures (5) would otherwise trip on the sheer call count alone here,
  // which is a different rule than the one this test is proving.
  const policy = createRespawnPolicy({ now: () => 0 }, { crashLoopMaxFailures: 10 });

  assert.equal(policy.recordFailure({ isPortConflict: true }).action, "retry");
  assert.equal(policy.recordFailure({ isPortConflict: true }).action, "retry");
  assert.equal(policy.recordFailure({ isPortConflict: false }).action, "retry"); // breaks the streak
  assert.equal(policy.recordFailure({ isPortConflict: true }).action, "retry");
  const fifth = policy.recordFailure({ isPortConflict: true });

  // Only 2 consecutive PORT_IN_USE failures since the reset — must not have tripped yet.
  assert.equal(fifth.action, "retry");
  assert.equal(policy.isTripped(), false);
});

test("reset() clears both counters and the tripped flag so a manual restart always gets a fresh ladder", () => {
  const policy = createRespawnPolicy({ now: () => 0 });
  for (let i = 0; i < 5; i += 1) policy.recordFailure({ isPortConflict: false });
  assert.equal(policy.isTripped(), true);

  policy.reset();

  assert.equal(policy.isTripped(), false);
  assert.deepEqual(policy.recordFailure({ isPortConflict: false }), { action: "retry", delayMs: 1_000, attempt: 1 });
});

test("a failure exactly on the rolling-window boundary is pruned", () => {
  let clock = 0;
  const policy = createRespawnPolicy({ now: () => clock }, { crashLoopWindowMs: 10 });
  policy.recordFailure({ isPortConflict: false });
  clock = 10;
  assert.deepEqual(policy.recordFailure({ isPortConflict: false }), { action: "retry", delayMs: 1000, attempt: 1 });
});

test("thresholds and backoff entries reject invalid configurations", () => {
  for (const options of [{ backoffScheduleMs: [] }, { backoffScheduleMs: [-1] }, { crashLoopMaxFailures: 0 }, { crashLoopWindowMs: Infinity }, { portConflictMaxAttempts: 1.5 }]) {
    assert.throws(() => createRespawnPolicy({ now: () => 0 }, options), RangeError);
  }
});
