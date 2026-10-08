import { test as vitest, vi, onTestFinished } from "vitest";

/** Preserve node:test's test-local cleanup and spy assertions while using the package's runner. */
export interface TestContext {
  after(cleanup: () => void | Promise<void>): void;
  mock: {
    method<T extends object>(target: T, name: keyof T): { mock: { callCount(): number } };
    timers: { enable(options: { apis: string[] }): void; tick(ms: number): void };
  };
}

type Body = (context: TestContext) => void | Promise<void>;
type Options = { timeout?: number };

/** Only the node:test facilities used by the unchanged copied assertions are translated here. */
export default function test(name: string, body: Body): void;
export default function test(name: string, options: Options, body: Body): void;
export default function test(name: string, bodyOrOptions: Body | Options, optionalBody?: Body): void {
  const body = typeof bodyOrOptions === "function" ? bodyOrOptions : optionalBody!;
  const options = typeof bodyOrOptions === "function" ? {} : bodyOrOptions;
  vitest(name, async () => {
    const cleanups: Array<() => void | Promise<void>> = [];
    onTestFinished(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
    await body({
      after: (cleanup) => { cleanups.push(cleanup); },
      mock: {
        method: (target, name) => {
          const spy = vi.spyOn(target, name as never);
          cleanups.push(() => { spy.mockRestore(); });
          return { mock: { callCount: () => spy.mock.calls.length } };
        },
        timers: {
          enable: () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            cleanups.push(() => { vi.useRealTimers(); });
          },
          tick: (ms) => { vi.advanceTimersByTime(ms); },
        },
      },
    });
  }, options);
}
