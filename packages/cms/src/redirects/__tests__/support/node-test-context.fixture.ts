import { onTestFinished, vi } from "vitest";

/**
 * The narrow node:test context used by the copied suites, backed by Vitest spies.
 * Arguments and return values are recorded unchanged; this never rewrites oracle evidence.
 * @returns A method-spy seam with node:test's call-record shape and per-test cleanup.
 * @complexity O(1) setup; reading calls is O(number of recorded calls).
 */
export function nodeTestContext() {
  return {
    mock: {
      method<T extends object, K extends keyof T>(target: T, name: K, implementation?: T[K]) {
        type Method = (...args: any[]) => any;
        const spy = vi.spyOn(target as unknown as Record<string, Method>, String(name));
        if (implementation !== undefined) spy.mockImplementation(implementation as Method);
        onTestFinished(() => spy.mockRestore());
        return {
          mock: {
            callCount: () => spy.mock.calls.length,
            get calls() {
              return spy.mock.calls.map((args, index) => ({ arguments: args, result: spy.mock.results[index]?.value }));
            },
          },
        };
      },
    },
  };
}
