import { expect, test, vi } from "vitest";

import { withAcceptanceCancellation } from "../acceptance-cancellation.js";

/** L13 Stryker: the abort listener, its `finally` removal and the already-aborted retry had no test. */

test("no abort: the start result is returned and cancel never runs", async () => {
  const cancel = vi.fn(async () => {});
  const controller = new AbortController();
  expect(await withAcceptanceCancellation({ signal: controller.signal, start: async () => "accepted", cancel })).toBe("accepted");
  controller.abort();
  expect(cancel).not.toHaveBeenCalled();
});

test("Stop while starting cancels immediately and once more after the start settles", async () => {
  const cancel = vi.fn(async () => {});
  const controller = new AbortController();
  let accept!: (value: string) => void;
  const pending = withAcceptanceCancellation({ signal: controller.signal, start: () => new Promise<string>(resolve => { accept = resolve; }), cancel });
  controller.abort();
  expect(cancel).toHaveBeenCalledTimes(1);
  accept("accepted");
  expect(await pending).toBe("accepted");
  expect(cancel).toHaveBeenCalledTimes(2);
});

test("an already-aborted signal still retries the cancel after a failed start, and the start error wins", async () => {
  const cancel = vi.fn(async () => { throw new Error("cancel lost"); });
  const controller = new AbortController();
  controller.abort();
  const failure = new Error("start lost");
  await expect(withAcceptanceCancellation({ signal: controller.signal, start: async () => { throw failure; }, cancel })).rejects.toBe(failure);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("the abort listener is registered once and removed in finally", async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  await withAcceptanceCancellation({ signal: controller.signal, start: async () => 1, cancel: async () => {} });
  expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
  expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
});

test("without a signal it simply runs start", async () => {
  const cancel = vi.fn(async () => {});
  expect(await withAcceptanceCancellation({ start: async () => 7, cancel })).toBe(7);
  expect(cancel).not.toHaveBeenCalled();
});

test("a failing immediate cancel is swallowed and the post-start retry still runs", async () => {
  const cancel = vi.fn(async () => { throw new Error("cancel lost"); });
  const controller = new AbortController();
  let accept!: (value: string) => void;
  const pending = withAcceptanceCancellation({ signal: controller.signal, start: () => new Promise<string>(resolve => { accept = resolve; }), cancel });
  controller.abort();
  await Promise.resolve();
  accept("accepted");
  expect(await pending).toBe("accepted");
  expect(cancel).toHaveBeenCalledTimes(2);
});
