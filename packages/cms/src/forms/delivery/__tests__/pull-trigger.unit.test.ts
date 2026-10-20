/**
 * @file Unit tests for the background pull runner: `run()` never rejects, errors reach `onError`
 * only, and `stop()` refuses new runs while waiting for live ones.
 */
import { describe, expect, test } from "vitest";
import { createFormPullTrigger } from "../index.js";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open };
}

describe("run", () => {
  test("runs the pull and resolves when it finishes", async () => {
    let runs = 0;
    const trigger = createFormPullTrigger({ run: async () => { runs++; }, onError: () => { throw new Error("unexpected"); } });
    await expect(trigger.run()).resolves.toBeUndefined();
    expect(runs).toBe(1);
  });

  test("a rejecting pull resolves and hands its error to onError", async () => {
    const errors: unknown[] = [];
    const failure = new Error("receiver offline");
    const trigger = createFormPullTrigger({ run: async () => { throw failure; }, onError: error => { errors.push(error); } });
    await expect(trigger.run()).resolves.toBeUndefined();
    expect(errors).toEqual([failure]);
  });

  test("a pull that throws synchronously is caught the same way", async () => {
    const errors: unknown[] = [];
    const run = (): Promise<void> => { throw new Error("not configured"); };
    const trigger = createFormPullTrigger({ run, onError: error => { errors.push(error); } });
    await expect(trigger.run()).resolves.toBeUndefined();
    expect((errors[0] as Error).message).toBe("not configured");
  });

  test("a throwing onError is swallowed", async () => {
    const trigger = createFormPullTrigger({ run: async () => { throw new Error("pull failed"); }, onError: () => { throw new Error("logger down"); } });
    await expect(trigger.run()).resolves.toBeUndefined();
  });

  test("the caller is not blocked: run returns before the pull starts", async () => {
    let started = false;
    const trigger = createFormPullTrigger({ run: async () => { started = true; }, onError: () => {} });
    const running = trigger.run();
    expect(started).toBe(false);
    await running;
    expect(started).toBe(true);
  });
});

describe("stop", () => {
  test("waits for a live pull to finish", async () => {
    const { opened, open } = gate();
    let finished = false;
    const trigger = createFormPullTrigger({ run: async () => { await opened; finished = true; }, onError: () => {} });
    void trigger.run();
    const stopping = trigger.stop().then(() => finished);
    open();
    await expect(stopping).resolves.toBe(true);
  });

  test("refuses runs requested after it was called", async () => {
    let runs = 0;
    const trigger = createFormPullTrigger({ run: async () => { runs++; }, onError: () => {} });
    await trigger.stop();
    await expect(trigger.run()).resolves.toBeUndefined();
    expect(runs).toBe(0);
  });

});
