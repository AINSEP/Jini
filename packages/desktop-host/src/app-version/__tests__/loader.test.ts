/** Version loader: one read per `start()`, never a guessed version, failures contained as state. */
import { describe, expect, test } from "vitest";
import { createAppVersionLoader } from "../loader.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createAppVersionLoader", () => {
  test("reads the version once per start and keeps it across snapshot reads", async () => {
    let reads = 0;
    const loader = createAppVersionLoader({ bridge: { getAppVersion: async () => { reads += 1; return "4.8.2-beta.5"; } } });
    expect(loader.getSnapshot()).toEqual({ version: null, error: null });
    loader.start();
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: "4.8.2-beta.5", error: null });
    expect(loader.getSnapshot()).toBe(loader.getSnapshot());
    expect(reads).toBe(1);
  });

  test("notifies subscribers when the snapshot changes and stops after unsubscribe", async () => {
    const loader = createAppVersionLoader({ bridge: { getAppVersion: async () => "1.0.0" } });
    let notified = 0;
    const unsubscribe = loader.subscribe(() => { notified += 1; });
    loader.start();
    await settle();
    expect(notified).toBeGreaterThan(0);
    const before = notified;
    unsubscribe();
    loader.start();
    await settle();
    expect(notified).toBe(before);
  });

  test("a reply that arrives after the returned dispose is dropped", async () => {
    const reply = deferred<string>();
    const loader = createAppVersionLoader({ bridge: { getAppVersion: () => reply.promise } });
    const dispose = loader.start();
    dispose();
    reply.resolve("2.3.4");
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: null, error: null });
  });

  test("a bridge without the method, or no bridge at all, stays empty and reads nothing", async () => {
    for (const bridge of [{}, undefined]) {
      const loader = createAppVersionLoader({ bridge });
      const dispose = loader.start();
      dispose();
      await settle();
      expect(loader.getSnapshot()).toEqual({ version: null, error: null });
    }
  });

  test("a disposed request's late rejection leaves a newer version intact", async () => {
    const reply = deferred<string>();
    let reads = 0;
    const loader = createAppVersionLoader({
      bridge: { getAppVersion: () => ++reads === 1 ? reply.promise : Promise.resolve("3.0.1") },
    });
    const dispose = loader.start();
    dispose();
    loader.start();
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: "3.0.1", error: null });
    reply.reject(new Error("stale IPC failure"));
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: "3.0.1", error: null });
  });

  test("a rejection keeps the error's message; a non-Error rejection is its string form", async () => {
    const failing = createAppVersionLoader({ bridge: { getAppVersion: async () => { throw new Error("IPC down"); } } });
    failing.start();
    await settle();
    expect(failing.getSnapshot()).toEqual({ version: null, error: "IPC down" });
    const thrown = createAppVersionLoader({ bridge: { getAppVersion: (): Promise<string> => { throw "Version bridge disconnected"; } } });
    thrown.start();
    await settle();
    expect(thrown.getSnapshot()).toEqual({ version: null, error: "Version bridge disconnected" });
  });

  test("a second start clears the previous version at once and reads again", async () => {
    let reads = 0;
    const loader = createAppVersionLoader({ bridge: { getAppVersion: async () => `v${++reads}` } });
    loader.start();
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: "v1", error: null });
    loader.start();
    expect(loader.getSnapshot()).toEqual({ version: null, error: null });
    await settle();
    expect(loader.getSnapshot()).toEqual({ version: "v2", error: null });
  });
});
