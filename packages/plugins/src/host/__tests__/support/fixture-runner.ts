import { test as vitestTest, onTestFinished } from 'vitest';
export interface TestContext {
  after(callback: () => unknown): void;
  mock: { method<T extends object, K extends keyof T>(object: T, key: K, implementation: unknown): { mock: { restore(): void } } };
}
export const test = (name: string, body: (context: TestContext) => unknown) => vitestTest(name, async () => { await body({
  after: (callback) => onTestFinished(async () => { await callback(); }),
  mock: { method(object, key, implementation) {
    const original = object[key];
    object[key] = implementation as typeof original;
    const restore = () => { object[key] = original; };
    onTestFinished(restore);
    return { mock: { restore } };
  } },
}); });
