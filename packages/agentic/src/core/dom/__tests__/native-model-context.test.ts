/**
 * Direct tests for the native WebMCP `modelContext` adapter. `model-context.test.ts` proves feature
 * detection; nothing invoked the adapter's methods, so a lost receiver binding (calling
 * `registerTool` unbound throws "Illegal invocation" on a real browser object) would ship green.
 */
import { describe, expect, it } from 'vitest';
import { adaptNativeModelContext } from '../native-model-context.js';
import type { AgentModelContextToolRegistration } from '../model-context.js';

const tool: AgentModelContextToolRegistration = { name: 'search', description: 'Search', inputSchema: { type: 'object' }, execute: async () => 'ok' };

class StrictNative {
  readonly calls: unknown[][] = [];
  registerTool(this: StrictNative, registration: unknown, options?: unknown): Promise<void> {
    if (!(this instanceof StrictNative)) throw new TypeError('Illegal invocation');
    this.calls.push(['register', registration, options]);
    return Promise.resolve();
  }
}
class StrictNativeWithUnregister extends StrictNative {
  unregisterTool(this: StrictNative, name: string): void {
    if (!(this instanceof StrictNative)) throw new TypeError('Illegal invocation');
    this.calls.push(['unregister', name]);
  }
}

describe('adaptNativeModelContext', () => {
  it('returns undefined for anything without a registerTool function', () => {
    for (const value of [undefined, null, 'modelContext', 42, {}, { registerTool: 'nope' }]) {
      expect(adaptNativeModelContext({ value })).toBeUndefined();
    }
  });

  it('forwards registerTool positionally on the native receiver and returns its promise', async () => {
    const native = new StrictNative();
    const adapter = adaptNativeModelContext({ value: native })!;
    const controller = new AbortController();
    const options = { signal: controller.signal, exposedTo: ['agent'] };
    await expect(adapter.registerTool({ tool }, options)).resolves.toBeUndefined();
    await adapter.registerTool({ tool });
    expect(native.calls).toEqual([['register', tool, options], ['register', tool, undefined]]);
  });

  it('exposes unregisterTool only when the native object has one, bound to its receiver', () => {
    expect('unregisterTool' in adaptNativeModelContext({ value: new StrictNative() })!).toBe(false);
    const native = new StrictNativeWithUnregister();
    const adapter = adaptNativeModelContext({ value: native })!;
    adapter.unregisterTool!({ name: 'search' });
    expect(native.calls).toEqual([['unregister', 'search']]);
  });

  it('returns the same adapter for the same native object and a distinct one for another', () => {
    const native = new StrictNative();
    const first = adaptNativeModelContext({ value: native });
    expect(adaptNativeModelContext({ value: native })).toBe(first);
    expect(adaptNativeModelContext({ value: new StrictNative() })).not.toBe(first);
  });
});
