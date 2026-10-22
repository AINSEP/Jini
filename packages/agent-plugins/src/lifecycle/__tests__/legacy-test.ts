import { test as vitestTest, type TestContext } from 'vitest';
type LegacyTestOptions = { skip?: boolean | string; timeout?: number };
export function test(name: string, fn: (context: TestContext) => void | Promise<void>): void;
export function test(name: string, options: LegacyTestOptions, fn: (context: TestContext) => void | Promise<void>): void;
export function test(name: string, second: ((context: TestContext) => void | Promise<void>) | LegacyTestOptions, third?: (context: TestContext) => void | Promise<void>): void {
  if (typeof second === 'function') { vitestTest(name, second); return; }
  if (!third) throw new Error('Missing test callback');
  // Keep copied Node test timeouts effective when registering them with Vitest.
  if (second.skip) vitestTest.skip(name, third, second.timeout);
  else vitestTest(name, third, second.timeout);
}
