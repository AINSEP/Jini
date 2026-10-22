import { afterEach, beforeEach, expect, test, vi } from "vitest";

class ApiError extends Error { readonly code = "unreachable"; }
const isUnreachable = (error: unknown) => error instanceof ApiError;

import { isAbortError, retryWhileUnreachable } from "../retry-unreachable.js";

/**
 * @file `retryWhileUnreachable`'s own contract — the branches `AssistantDock.load-recovery.unit.test.tsx`
 * does not reach through the dock: an already-aborted signal, a custom delay schedule running out, and
 * `isAbortError`'s duck typing. The dock suite pins the live behavior (restart survival, no error log
 * for cancellations); this pins the primitive.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function unreachable(): ApiError {
  return new ApiError("unreachable");
}

test("an already-aborted signal stops before the first wait, leaving no timer behind", async () => {
  const controller = new AbortController();
  controller.abort();
  const load = vi.fn(async () => {
    throw unreachable();
  });

  const error = await retryWhileUnreachable({ load, isUnreachable, signal: controller.signal }).catch((e: unknown) => e);

  expect(isAbortError({ error: error })).toBe(true);
  expect((error as Error).message).toBe("retry cancelled");
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("once the delays run out, the last unreachable error is rethrown unchanged", async () => {
  const errors = [unreachable(), unreachable(), unreachable()];
  const load = vi.fn(async () => {
    throw errors[load.mock.calls.length - 1];
  });

  const settled = retryWhileUnreachable({ load, isUnreachable, signal: new AbortController().signal }, { delaysMs: [10, 20] }).catch(
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(30);

  expect(await settled).toBe(errors[2]);
  expect(load).toHaveBeenCalledTimes(3);
});

test("a success after a retry resolves with that result", async () => {
  const load = vi.fn().mockRejectedValueOnce(unreachable()).mockResolvedValueOnce("ok");

  const settled = retryWhileUnreachable({ load, isUnreachable, signal: new AbortController().signal }, { delaysMs: [10] });
  await vi.advanceTimersByTimeAsync(10);

  expect(await settled).toBe("ok");
  expect(load).toHaveBeenCalledTimes(2);
});

test("isAbortError matches by name only", () => {
  expect(isAbortError({ error: new DOMException("x", "AbortError") })).toBe(true);
  expect(isAbortError({ error: { name: "AbortError" } })).toBe(true);
  expect(isAbortError({ error: new Error("AbortError") })).toBe(false);
  expect(isAbortError({ error: unreachable() })).toBe(false);
  expect(isAbortError({ error: null })).toBe(false);
  expect(isAbortError({ error: "AbortError" })).toBe(false);
});
