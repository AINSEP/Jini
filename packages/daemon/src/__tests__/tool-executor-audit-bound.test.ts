import { createToolRegistry, type Principal, type RunRef, type ToolRegistry } from '@jini-ai/core';
import { describe, expect, it } from 'vitest';

import { createToolExecutor, DEFAULT_MAX_AUDIT_RECORDS } from '../tool-executor.js';

const principal: Principal = { id: 'user-1' };
const run: RunRef = { id: 'run-1' };

function echoRegistry(gate?: Promise<void>): ToolRegistry {
  const registry = createToolRegistry({});
  registry.register({ descriptor: { id: 'echo' }, policy: { authorize: () => 'allow' }, handler: async (ctx) => `echo:${String(ctx.input)}` });
  registry.register({ descriptor: { id: 'slow' }, policy: { authorize: () => 'allow' }, handler: async () => { await gate; return 'slow done'; } });
  registry.register({ descriptor: { id: 'deny' }, policy: { authorize: () => 'deny' }, handler: async () => 'unused' });
  return registry;
}

function retained(executor: ReturnType<typeof createToolExecutor>, ids: readonly string[]): number {
  return ids.filter((executionId) => executor.getAuditRecord({ executionId }) !== null).length;
}

describe('@jini-ai/daemon — ToolExecutor — audit record bound', () => {
  it('defaults the cap to 1000 finished records', () => {
    expect(DEFAULT_MAX_AUDIT_RECORDS).toBe(1000);
  });

  it('keeps at most maxAuditRecords finished records (N=200, cap 50: 200 before, 50 after), newest kept', async () => {
    const executor = createToolExecutor({ registry: echoRegistry() }, { maxAuditRecords: 50 });
    const ids: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const toolId = i % 2 === 0 ? 'echo' : 'deny';
      ids.push((await executor.execute({ principal, run, toolId, input: i })).executionId);
    }
    expect(retained(executor, ids)).toBe(50);
    expect(executor.getAuditRecord({ executionId: ids[0]! })).toBeNull();
    expect(executor.getAuditRecord({ executionId: ids[199]! })?.events.at(-1)?.phase).toBe('denied');
  });

  it('applies the default cap when none is passed (1005 executions -> 1000 retained)', async () => {
    const executor = createToolExecutor({ registry: echoRegistry() });
    const ids: string[] = [];
    for (let i = 0; i < DEFAULT_MAX_AUDIT_RECORDS + 5; i += 1) {
      ids.push((await executor.execute({ principal, run, toolId: 'echo', input: i })).executionId);
    }
    expect(retained(executor, ids)).toBe(DEFAULT_MAX_AUDIT_RECORDS);
  });

  it('never evicts an in-flight execution: its record survives the cap and receives its terminal transition', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executor = createToolExecutor({ registry: echoRegistry(gate) }, { maxAuditRecords: 2 });
    const slow = executor.execute({ principal, run, toolId: 'slow', input: null });
    for (let i = 0; i < 10; i += 1) await executor.execute({ principal, run, toolId: 'echo', input: i });
    release();
    const result = await slow;
    expect(result.status).toBe('completed');
    expect(executor.getAuditRecord({ executionId: result.executionId })?.events.map((event) => event.phase)).toEqual(['requested', 'authorized', 'started', 'completed']);
  });
});
