/** @file Runner adapter for the moved node:test media-html suites: they spy on `console.warn` through
 *  node:test's `t.mock.method(target, key, implementation)` and read `mock.callCount()` /
 *  `mock.calls[i].arguments`, which vitest's own test context does not offer. Translating only that
 *  surface here keeps their test bodies and assertions byte-identical to the host originals. */
import { test as vitestTest, onTestFinished, vi } from "vitest";

export interface NodeMockCall { arguments: unknown[] }
export interface NodeMockFunction {
  mock: { callCount(): number; readonly calls: NodeMockCall[] };
}
export interface NodeTestContext {
  mock: { method<T extends object, K extends keyof T>(target: T, key: K, implementation: T[K]): NodeMockFunction };
}
type Body = (context: NodeTestContext) => unknown;

export function test(name: string, body: Body): void {
  vitestTest(name, async () => {
    await body({
      mock: {
        method(target, key, implementation) {
          const spy = vi.spyOn(target, key as never).mockImplementation(implementation as never);
          onTestFinished(() => { spy.mockRestore(); });
          return {
            mock: {
              callCount: () => spy.mock.calls.length,
              get calls() { return spy.mock.calls.map((args: unknown[]) => ({ arguments: args })); },
            },
          };
        },
      },
    });
  });
}
