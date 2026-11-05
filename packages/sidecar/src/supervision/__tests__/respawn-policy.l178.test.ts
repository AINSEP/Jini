import { expect, test, vi } from "vitest";
import { createRespawnPolicy, type RespawnPolicyOptions } from "../respawn-policy.js";

const invalidOptions: [string, RespawnPolicyOptions, string][] = [
  ["empty ladder", { backoffScheduleMs: [] }, "backoffScheduleMs must contain finite non-negative delays"],
  ...[-1, NaN, Infinity, -Infinity].map((delay): [string, RespawnPolicyOptions, string] =>
    [`delay ${delay}`, { backoffScheduleMs: [0, delay] }, "backoffScheduleMs must contain finite non-negative delays"]),
  ...[0, -1, NaN, Infinity].map((window): [string, RespawnPolicyOptions, string] =>
    [`window ${window}`, { crashLoopWindowMs: window }, "crashLoopWindowMs must be positive and finite"]),
  ...["crashLoopMaxFailures", "portConflictMaxAttempts"].flatMap((key) =>
    [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((count): [string, RespawnPolicyOptions, string] =>
      [`${key} ${count}`, { [key]: count }, "failure thresholds must be positive safe integers"])),
];

test.each(invalidOptions)("rejects %s without reading the clock", (_label, options, message) => {
  const now = vi.fn(() => 0);
  expect(() => createRespawnPolicy({ now }, options)).toThrow(new RangeError(message));
  expect(now).not.toHaveBeenCalled();
});

test("validates the backoff before the window and the window before counts", () => {
  expect(() => createRespawnPolicy({ now: () => 0 }, { backoffScheduleMs: [], crashLoopWindowMs: 0, crashLoopMaxFailures: 0 }))
    .toThrow("backoffScheduleMs must contain finite non-negative delays");
  expect(() => createRespawnPolicy({ now: () => 0 }, { crashLoopWindowMs: 0, crashLoopMaxFailures: 0 }))
    .toThrow("crashLoopWindowMs must be positive and finite");
});

test("copies a custom ladder, accepts zero and fractional delays, and applies custom thresholds", () => {
  const ladder = [0, 0.5];
  const policy = createRespawnPolicy({ now: () => 0 }, {
    backoffScheduleMs: ladder, crashLoopWindowMs: 10, crashLoopMaxFailures: 3, portConflictMaxAttempts: 2,
  });
  ladder[0] = 99;
  expect(policy.recordFailure({ isPortConflict: false })).toEqual({ action: "retry", delayMs: 0, attempt: 1 });
  expect(policy.recordFailure({ isPortConflict: true })).toEqual({ action: "retry", delayMs: 0.5, attempt: 2 });
  expect(policy.recordFailure({ isPortConflict: true })).toEqual({ action: "give-up", kind: "port-conflict", attempts: 2 });
  policy.reset();
  policy.recordFailure({ isPortConflict: false });
  policy.recordFailure({ isPortConflict: false });
  expect(policy.recordFailure({ isPortConflict: false }))
    .toEqual({ action: "give-up", kind: "crash-loop", attempts: 3, windowMs: 10 });
});

test("uses all default settings for omitted options", () => {
  const now = vi.fn(() => 0);
  const policy = createRespawnPolicy({ now });
  expect(now).not.toHaveBeenCalled();
  expect(policy.recordFailure({ isPortConflict: false })).toEqual({ action: "retry", delayMs: 1000, attempt: 1 });
  expect(now).toHaveBeenCalledOnce();
});
