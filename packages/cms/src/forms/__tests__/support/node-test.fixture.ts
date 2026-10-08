/** Runner adapter for moved node:test suites; keeps their assertions and test bodies intact. */
import { test as vitestTest, onTestFinished } from "vitest";

export interface NodeTestContext {
  mock: { method<T extends object, K extends keyof T>(target: T, key: K, implementation: T[K]): void };
  after(callback: () => void | Promise<void>): void;
}
type Body = (context: NodeTestContext) => unknown;

export function test(name: string, body: Body): void;
export function test(name: string, options: { timeout?: number }, body: Body): void;
export function test(name: string, bodyOrOptions: Body | { timeout?: number }, suppliedBody?: Body): void {
  const body = typeof bodyOrOptions === "function" ? bodyOrOptions : suppliedBody!;
  const timeout = typeof bodyOrOptions === "function" ? undefined : bodyOrOptions.timeout;
  vitestTest(name, async () => {
    await body({
      mock: { method(target, key, implementation) {
        const original = target[key];
        target[key] = implementation;
        onTestFinished(() => { target[key] = original; });
      } },
      after: callback => { onTestFinished(callback); },
    });
  }, timeout);
}
