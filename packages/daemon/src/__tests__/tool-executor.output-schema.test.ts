import { createToolRegistry, type Principal, type RunRef, type ToolRegistration } from '@jini-ai/core';
import { describe, expect, it, vi } from 'vitest';

import { createToolExecutor } from '../tool-executor.js';

const principal: Principal = { id: 'user-1' };
const run: RunRef = { id: 'run-1' };

/** Declares a `{ count: number }` result but the handler returns `count` as a string. */
const outputSchema = { type: 'object', required: ['count'], properties: { count: { type: 'number' } } };

function registryWith({ registration }: { registration: ToolRegistration }) {
  const registry = createToolRegistry({});
  registry.register(registration);
  return registry;
}

function countTool({ output, withSchema }: { output: unknown; withSchema: boolean }): ToolRegistration {
  return {
    descriptor: { id: 'count_pages', ...(withSchema ? { outputSchema } : {}) },
    policy: { authorize: () => 'allow' },
    handler: async () => output,
  };
}

describe('@jini-ai/daemon — ToolExecutor — output validation', () => {
  it('a tool returning the wrong shape fails in enforce mode', async () => {
    const registry = registryWith({ registration: countTool({ output: { count: 'three' }, withSchema: true }) });
    const executor = createToolExecutor({ registry }, { outputValidation: 'enforce' });

    const result = await executor.execute({ principal, run, toolId: 'count_pages', input: {} });

    expect(result).toMatchObject({
      status: 'failed',
      errorKind: 'internal',
      error: 'The tool count_pages returned data in the wrong shape: count should be a number, but it was a string.',
    });
    expect(result.output).toBeUndefined();
    expect(executor.getAuditRecord({ executionId: result.executionId })?.events.at(-1)?.phase).toBe('failed');
  });

  it('enforce is the default when the host chooses nothing', async () => {
    const registry = registryWith({ registration: countTool({ output: [], withSchema: true }) });
    const result = await createToolExecutor({ registry }).execute({ principal, run, toolId: 'count_pages', input: {} });
    expect(result).toMatchObject({ status: 'failed', error: 'The tool count_pages returned data in the wrong shape: the result should be an object, but it was an array.' });
  });

  it('log mode passes the result through and reports the mismatch once', async () => {
    const warn = vi.fn();
    const registry = registryWith({ registration: countTool({ output: { count: 'three' }, withSchema: true }) });
    const executor = createToolExecutor({ registry }, { outputValidation: 'log', logger: { warn } });

    const result = await executor.execute({ principal, run, toolId: 'count_pages', input: {} });

    expect(result).toMatchObject({ status: 'completed', output: { count: 'three' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { message: 'The tool count_pages returned data in the wrong shape: count should be a number, but it was a string.' },
      { meta: { toolId: 'count_pages', executionId: result.executionId, runId: 'run-1' } },
    );
  });

  it('a result that matches its outputSchema completes and logs nothing', async () => {
    const warn = vi.fn();
    const registry = registryWith({ registration: countTool({ output: { count: 3 }, withSchema: true }) });
    const result = await createToolExecutor({ registry }, { outputValidation: 'log', logger: { warn } })
      .execute({ principal, run, toolId: 'count_pages', input: {} });
    expect(result).toMatchObject({ status: 'completed', output: { count: 3 } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a tool without outputSchema is unchanged', async () => {
    const warn = vi.fn();
    const registry = registryWith({ registration: countTool({ output: { count: 'three' }, withSchema: false }) });
    const result = await createToolExecutor({ registry }, { outputValidation: 'enforce', logger: { warn } })
      .execute({ principal, run, toolId: 'count_pages', input: {} });
    expect(result).toEqual({ executionId: result.executionId, status: 'completed', output: { count: 'three' }, truncated: false });
    expect(warn).not.toHaveBeenCalled();
  });
});
